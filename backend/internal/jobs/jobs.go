package jobs

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/alloysrc"
	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/buildspec"
	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/executor"
)

type Status string

const (
	StatusQueued     Status = "queued"
	StatusCloning    Status = "cloning"
	StatusGenerating Status = "generating"
	StatusBuilding   Status = "building"
	StatusDone       Status = "done"
	StatusError      Status = "error"
)

type Target struct {
	OS   string `json:"os"`
	Arch string `json:"arch"`
}

type Request struct {
	Version        string
	ComponentNames []string
	ImportPaths    []string
	Targets        []Target
	Output         string
	Strategy       string
	VersionInfo    buildspec.VersionInfo
}

type Artifact struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type Snapshot struct {
	ID        string     `json:"id"`
	Status    Status     `json:"status"`
	Error     string     `json:"error,omitempty"`
	Artifacts []Artifact `json:"artifacts"`
}

type SourceManager interface {
	Ensure(cacheRoot, version string) (string, error)
	PrepareWorkspace(cloneDir, workDir string) error
	RewriteAll(workDir string, importPaths []string) error
}

type alloySourceManager struct{}

func (alloySourceManager) Ensure(cacheRoot, version string) (string, error) {
	return alloysrc.Ensure(cacheRoot, version)
}

func (alloySourceManager) PrepareWorkspace(cloneDir, workDir string) error {
	return alloysrc.PrepareWorkspace(cloneDir, workDir)
}

func (alloySourceManager) RewriteAll(workDir string, importPaths []string) error {
	return alloysrc.RewriteAll(workDir, importPaths)
}

type Options struct {
	CacheRoot     string
	WorkspaceRoot string
	ArtifactRoot  string
	Source        SourceManager
	Docker        executor.Executor
	Host          executor.Executor
	LogLimit      int
}

type Queue struct {
	cacheRoot     string
	workspaceRoot string
	artifactRoot  string
	source        SourceManager
	docker        executor.Executor
	host          executor.Executor
	logLimit      int

	mu      sync.Mutex
	jobs    map[string]*Job
	pending []*Job
	running bool
	seq     atomic.Uint64
}

type Job struct {
	id  string
	req Request
	q   *Queue

	mu          sync.Mutex
	status      Status
	err         string
	artifacts   []Artifact
	logs        []string
	subscribers map[chan string]struct{}
	done        chan struct{}
	doneOnce    sync.Once
}

func NewQueue(opts Options) (*Queue, error) {
	cacheRoot := opts.CacheRoot
	if cacheRoot == "" {
		cacheRoot = DefaultCacheRoot()
		if err := ensureWritableDir(cacheRoot); err != nil {
			cacheRoot = filepath.Join(".cache", "custom-alloy-builder")
		}
	}
	cacheRoot, err := filepath.Abs(cacheRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve cache root: %w", err)
	}
	workspaceRoot := opts.WorkspaceRoot
	if workspaceRoot == "" {
		workspaceRoot = filepath.Join(cacheRoot, "workspaces")
	}
	workspaceRoot, err = filepath.Abs(workspaceRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace root: %w", err)
	}
	artifactRoot := opts.ArtifactRoot
	if artifactRoot == "" {
		artifactRoot = filepath.Join(cacheRoot, "artifacts")
	}
	artifactRoot, err = filepath.Abs(artifactRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve artifact root: %w", err)
	}
	for _, dir := range []string{cacheRoot, workspaceRoot, artifactRoot} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create %s: %w", dir, err)
		}
	}
	source := opts.Source
	if source == nil {
		source = alloySourceManager{}
	}
	docker := opts.Docker
	if docker == nil {
		docker = executor.DockerExecutor{}
	}
	host := opts.Host
	if host == nil {
		host = executor.HostExecutor{}
	}
	logLimit := opts.LogLimit
	if logLimit <= 0 {
		logLimit = 2000
	}
	return &Queue{
		cacheRoot:     cacheRoot,
		workspaceRoot: workspaceRoot,
		artifactRoot:  artifactRoot,
		source:        source,
		docker:        docker,
		host:          host,
		logLimit:      logLimit,
		jobs:          map[string]*Job{},
	}, nil
}

func DefaultCacheRoot() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".cache/custom-alloy-builder"
	}
	return filepath.Join(home, ".cache", "custom-alloy-builder")
}

func ensureWritableDir(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	probe, err := os.CreateTemp(dir, ".write-test-*")
	if err != nil {
		return err
	}
	name := probe.Name()
	if err := probe.Close(); err != nil {
		return err
	}
	return os.Remove(name)
}

func (q *Queue) Enqueue(req Request) (*Job, error) {
	if err := validateRequest(req); err != nil {
		return nil, err
	}
	id := fmt.Sprintf("b%06d-%d", q.seq.Add(1), time.Now().UnixNano())
	job := &Job{
		id:          id,
		req:         req,
		q:           q,
		status:      StatusQueued,
		subscribers: map[chan string]struct{}{},
		done:        make(chan struct{}),
	}

	q.mu.Lock()
	q.jobs[id] = job
	q.pending = append(q.pending, job)
	shouldStart := !q.running
	if shouldStart {
		q.running = true
	}
	q.mu.Unlock()

	job.writeLog("queued build %s for %d target(s)", req.Version, len(req.Targets))
	if shouldStart {
		go q.run()
	}
	return job, nil
}

func (q *Queue) Get(id string) (*Job, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	job, ok := q.jobs[id]
	return job, ok
}

func (q *Queue) run() {
	for {
		q.mu.Lock()
		if len(q.pending) == 0 {
			q.running = false
			q.mu.Unlock()
			return
		}
		job := q.pending[0]
		q.pending = q.pending[1:]
		q.mu.Unlock()
		job.run(context.Background())
	}
}

func (j *Job) ID() string {
	return j.id
}

func (j *Job) Snapshot() Snapshot {
	j.mu.Lock()
	defer j.mu.Unlock()
	artifacts := slices.Clone(j.artifacts)
	if artifacts == nil {
		artifacts = []Artifact{}
	}
	return Snapshot{
		ID:        j.id,
		Status:    j.status,
		Error:     j.err,
		Artifacts: artifacts,
	}
}

func (j *Job) ArtifactPath(name string) (string, bool) {
	clean := filepath.Base(name)
	if clean != name || name == "" {
		return "", false
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, artifact := range j.artifacts {
		if artifact.Name == name {
			return filepath.Join(j.q.artifactRoot, j.id, artifact.Name), true
		}
	}
	return "", false
}

func (j *Job) Subscribe() ([]string, <-chan string, <-chan struct{}, func()) {
	ch := make(chan string, 128)
	j.mu.Lock()
	existing := slices.Clone(j.logs)
	terminal := isTerminal(j.status)
	if !terminal {
		j.subscribers[ch] = struct{}{}
	}
	done := j.done
	j.mu.Unlock()

	cancel := func() {
		j.mu.Lock()
		if _, ok := j.subscribers[ch]; ok {
			delete(j.subscribers, ch)
			close(ch)
		}
		j.mu.Unlock()
	}
	return existing, ch, done, cancel
}

func (j *Job) run(ctx context.Context) {
	req := j.req
	j.setStatus(StatusCloning)
	j.writeLog("resolving Alloy source %s", req.Version)
	cloneDir, err := j.q.source.Ensure(j.q.cacheRoot, req.Version)
	if err != nil {
		j.fail(err)
		return
	}

	j.setStatus(StatusGenerating)
	workDir := filepath.Join(j.q.workspaceRoot, j.id)
	j.writeLog("preparing workspace %s", workDir)
	if err := j.q.source.PrepareWorkspace(cloneDir, workDir); err != nil {
		j.fail(err)
		return
	}
	j.writeLog("rewriting component imports")
	if err := j.q.source.RewriteAll(workDir, req.ImportPaths); err != nil {
		j.fail(err)
		return
	}

	j.setStatus(StatusBuilding)
	artifactDir := filepath.Join(j.q.artifactRoot, j.id)
	if err := os.MkdirAll(artifactDir, 0o755); err != nil {
		j.fail(err)
		return
	}
	for _, target := range req.Targets {
		name := artifactName(req.Version, target)
		outputPath := filepath.Join(artifactDir, name)
		j.writeLog("building %s/%s", target.OS, target.Arch)
		spec := executor.Spec{
			Version:       req.Version,
			WorkDir:       workDir,
			CacheRoot:     filepath.Join(j.q.cacheRoot, "build-cache"),
			GOOS:          target.OS,
			GOARCH:        target.Arch,
			OutputPath:    outputPath,
			BuildImageTag: req.VersionInfo.BuildImageTag,
		}
		if err := j.executor().Build(ctx, spec, j.logWriter()); err != nil {
			j.fail(err)
			return
		}
		info, err := os.Stat(outputPath)
		if err != nil {
			j.fail(fmt.Errorf("stat artifact: %w", err))
			return
		}
		j.addArtifact(Artifact{Name: name, Size: info.Size()})
		j.writeLog("wrote artifact %s", name)
	}
	j.setStatus(StatusDone)
	j.writeLog("build complete")
	j.finish()
}

func (j *Job) executor() executor.Executor {
	if j.req.Strategy == "host" {
		return j.q.host
	}
	return j.q.docker
}

func (j *Job) fail(err error) {
	j.mu.Lock()
	j.status = StatusError
	j.err = err.Error()
	j.mu.Unlock()
	j.writeLog("error: %s", err)
	j.finish()
}

func (j *Job) setStatus(status Status) {
	j.mu.Lock()
	j.status = status
	j.mu.Unlock()
	j.writeLog("status: %s", status)
}

func (j *Job) addArtifact(artifact Artifact) {
	j.mu.Lock()
	j.artifacts = append(j.artifacts, artifact)
	j.mu.Unlock()
}

func (j *Job) finish() {
	j.doneOnce.Do(func() {
		j.mu.Lock()
		for ch := range j.subscribers {
			close(ch)
		}
		j.subscribers = map[chan string]struct{}{}
		j.mu.Unlock()
		close(j.done)
	})
}

func (j *Job) writeLog(format string, args ...any) {
	line := fmt.Sprintf(format, args...)
	line = strings.TrimRight(line, "\r\n")
	if line == "" {
		return
	}
	j.mu.Lock()
	j.logs = append(j.logs, line)
	if len(j.logs) > j.q.logLimit {
		j.logs = slices.Clone(j.logs[len(j.logs)-j.q.logLimit:])
	}
	for ch := range j.subscribers {
		select {
		case ch <- line:
		default:
		}
	}
	j.mu.Unlock()
}

func (j *Job) logWriter() io.Writer {
	return writerFunc(func(p []byte) (int, error) {
		for _, line := range strings.Split(strings.ReplaceAll(string(p), "\r\n", "\n"), "\n") {
			j.writeLog("%s", line)
		}
		return len(p), nil
	})
}

type writerFunc func([]byte) (int, error)

func (fn writerFunc) Write(p []byte) (int, error) {
	return fn(p)
}

func validateRequest(req Request) error {
	if req.Version == "" {
		return errors.New("version is required")
	}
	if len(req.ImportPaths) == 0 {
		return errors.New("at least one component is required")
	}
	if req.Output != "binary" {
		return errors.New("output must be binary")
	}
	if req.Strategy != "docker" && req.Strategy != "host" {
		return errors.New("strategy must be docker or host")
	}
	if len(req.Targets) == 0 {
		return errors.New("at least one target is required")
	}
	for _, target := range req.Targets {
		if target.OS == "" || target.Arch == "" {
			return errors.New("target os and arch are required")
		}
		if req.Strategy == "docker" && target.OS != "linux" {
			return errors.New("docker strategy only supports linux targets")
		}
		if req.Strategy == "host" && (target.OS != runtime.GOOS || target.Arch != runtime.GOARCH) {
			return fmt.Errorf("host strategy only supports %s/%s", runtime.GOOS, runtime.GOARCH)
		}
	}
	return nil
}

func artifactName(version string, target Target) string {
	cleanVersion := strings.TrimPrefix(version, "v")
	return fmt.Sprintf("alloy-custom-%s-%s-%s", cleanVersion, target.OS, target.Arch)
}

func isTerminal(status Status) bool {
	return status == StatusDone || status == StatusError
}
