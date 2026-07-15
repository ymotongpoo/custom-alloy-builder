package executor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type Spec struct {
	Version       string
	WorkDir       string
	CacheRoot     string
	GOOS          string
	GOARCH        string
	OutputPath    string
	Output        string
	ImageTag      string
	BuildImageTag string
	GoVersion     string
}

type Executor interface {
	Build(ctx context.Context, spec Spec, logs io.Writer) error
}

type DockerExecutor struct{}

type HostExecutor struct{}

func (DockerExecutor) Build(ctx context.Context, spec Spec, logs io.Writer) error {
	if err := validateSpec(spec); err != nil {
		return err
	}
	if logs == nil {
		logs = io.Discard
	}
	cacheRoot := spec.CacheRoot
	if cacheRoot == "" {
		cacheRoot = filepath.Join(spec.WorkDir, ".cache")
	}
	for _, dir := range []string{
		filepath.Join(spec.WorkDir, ".tmp"),
		filepath.Join(cacheRoot, "home"),
		filepath.Join(cacheRoot, "go-build"),
		filepath.Join(cacheRoot, "go-mod"),
		filepath.Join(cacheRoot, "npm"),
		filepath.Join(cacheRoot, "docker"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create container cache dir: %w", err)
		}
	}
	absCacheRoot, err := filepath.Abs(cacheRoot)
	if err != nil {
		return fmt.Errorf("resolve cache root: %w", err)
	}

	if spec.Output == "image" {
		return buildDockerImage(ctx, spec, logs, cacheRoot)
	}
	return buildDockerBinary(ctx, spec, logs, cacheRoot, absCacheRoot)
}

func buildDockerBinary(ctx context.Context, spec Spec, logs io.Writer, cacheRoot, absCacheRoot string) error {
	image := "grafana/alloy-build-image:" + spec.BuildImageTag
	args := []string{
		"run", "--rm",
		"-v", spec.WorkDir + ":/src",
		"-v", absCacheRoot + ":/cache",
		"-w", "/src",
		"-e", "GOOS=" + spec.GOOS,
		"-e", "GOARCH=" + spec.GOARCH,
		"-e", "TMPDIR=/src/.tmp",
		"-e", "GOTMPDIR=/src/.tmp",
		"-e", "HOME=/cache/home",
		"-e", "GOCACHE=/cache/go-build",
		"-e", "GOMODCACHE=/cache/go-mod",
		"-e", "NPM_CONFIG_CACHE=/cache/npm",
		image,
		"sh", "-c", "git config --global --add safe.directory /src && make alloy",
	}
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Env = append(os.Environ(), "DOCKER_CONFIG="+filepath.Join(cacheRoot, "docker"))
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker make alloy: %w", err)
	}

	built := filepath.Join(spec.WorkDir, "build", "alloy")
	if err := copyFile(built, spec.OutputPath); err != nil {
		return fmt.Errorf("copy built alloy binary: %w", err)
	}
	if err := os.Chmod(spec.OutputPath, 0o755); err != nil {
		return fmt.Errorf("chmod output binary: %w", err)
	}
	return nil
}

func buildDockerImage(ctx context.Context, spec Spec, logs io.Writer, cacheRoot string) error {
	if spec.ImageTag == "" {
		return errors.New("ImageTag is required for image output")
	}
	dockerfile, cleanup, err := imageDockerfile(spec.WorkDir)
	if err != nil {
		return err
	}
	defer cleanup()
	platform := spec.GOOS + "/" + spec.GOARCH
	if strings.Contains(spec.GOARCH, ",") {
		arches := strings.Split(spec.GOARCH, ",")
		platforms := make([]string, 0, len(arches))
		for _, arch := range arches {
			platforms = append(platforms, spec.GOOS+"/"+strings.TrimSpace(arch))
		}
		platform = strings.Join(platforms, ",")
	}
	args := []string{
		"buildx", "build",
		"-f", dockerfile,
		"--platform", platform,
	}
	if isSinglePlatform(platform) {
		args = append(args, "--load", "-t", spec.ImageTag)
	} else {
		args = append(args, "-o", "type=oci,dest="+spec.OutputPath)
	}
	args = append(args, spec.WorkDir)

	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Env = append(os.Environ(), "DOCKER_CONFIG="+filepath.Join(cacheRoot, "docker"))
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker buildx build image: %w", err)
	}
	return nil
}

func imageDockerfile(workDir string) (string, func(), error) {
	source := filepath.Join(workDir, "Dockerfile")
	data, err := os.ReadFile(source)
	if err != nil {
		return "", func() {}, fmt.Errorf("read upstream Dockerfile: %w", err)
	}
	text := string(data)
	pattern := "    GOOS=\"$TARGETOS\" GOARCH=\"$TARGETARCH\" GOARM=${TARGETVARIANT#v} \\\n"
	replacement := "    mkdir -p /root/.cache/go-build/tmp && \\\n" +
		"    TMPDIR=/root/.cache/go-build/tmp GOTMPDIR=/root/.cache/go-build/tmp GOFLAGS=\"-p=1\" \\\n" + pattern
	if !strings.Contains(text, pattern) {
		return "", func() {}, errors.New("upstream Dockerfile make alloy step changed; cannot inject build temp directory")
	}
	text = strings.Replace(text, pattern, replacement, 1)
	path := filepath.Join(workDir, ".custom-alloy-builder.Dockerfile")
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		return "", func() {}, fmt.Errorf("write image build Dockerfile: %w", err)
	}
	return path, func() { _ = os.Remove(path) }, nil
}

func (HostExecutor) Build(ctx context.Context, spec Spec, logs io.Writer) error {
	if err := validateSpec(spec); err != nil {
		return err
	}
	if spec.Output == "image" {
		return errors.New("host executor does not support image output; use the docker strategy")
	}
	if err := preflightHost(spec); err != nil {
		return err
	}
	if logs == nil {
		logs = io.Discard
	}
	cacheRoot := spec.CacheRoot
	if cacheRoot == "" {
		cacheRoot = filepath.Join(spec.WorkDir, ".cache")
	}
	for _, dir := range []string{
		filepath.Join(spec.WorkDir, ".tmp"),
		filepath.Join(cacheRoot, "home"),
		filepath.Join(cacheRoot, "go-build"),
		filepath.Join(cacheRoot, "go-mod"),
		filepath.Join(cacheRoot, "npm"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create build cache dir: %w", err)
		}
	}

	cmd := exec.CommandContext(ctx, "make", "alloy")
	cmd.Dir = spec.WorkDir
	cmd.Env = append(os.Environ(),
		"GOOS="+spec.GOOS,
		"GOARCH="+spec.GOARCH,
		"TMPDIR="+filepath.Join(spec.WorkDir, ".tmp"),
		"GOTMPDIR="+filepath.Join(spec.WorkDir, ".tmp"),
		"HOME="+filepath.Join(cacheRoot, "home"),
		"GOCACHE="+filepath.Join(cacheRoot, "go-build"),
		"GOMODCACHE="+filepath.Join(cacheRoot, "go-mod"),
		"NPM_CONFIG_CACHE="+filepath.Join(cacheRoot, "npm"),
	)
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("host make alloy: %w", err)
	}

	built := filepath.Join(spec.WorkDir, "build", "alloy")
	if err := copyFile(built, spec.OutputPath); err != nil {
		return fmt.Errorf("copy built alloy binary: %w", err)
	}
	if err := os.Chmod(spec.OutputPath, 0o755); err != nil {
		return fmt.Errorf("chmod output binary: %w", err)
	}
	return nil
}

func validateSpec(spec Spec) error {
	if spec.WorkDir == "" {
		return errors.New("WorkDir is required")
	}
	if spec.GOOS == "" {
		return errors.New("GOOS is required")
	}
	if spec.GOARCH == "" {
		return errors.New("GOARCH is required")
	}
	if spec.OutputPath == "" {
		return errors.New("OutputPath is required")
	}
	if spec.Output == "" {
		return errors.New("Output is required")
	}
	if spec.Output != "binary" && spec.Output != "image" {
		return errors.New("Output must be binary or image")
	}
	if spec.BuildImageTag == "" {
		return errors.New("BuildImageTag is required")
	}
	return nil
}

func preflightHost(spec Spec) error {
	if _, err := exec.LookPath("go"); err != nil {
		return errors.New("host strategy requires Go; install Go and ensure the go command is on PATH")
	}
	cmd := exec.Command("go", "version")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("host strategy requires a runnable Go toolchain: go version failed: %w: %s", err, strings.TrimSpace(string(out)))
	}
	if spec.GoVersion != "" {
		current, ok := parseGoVersion(string(out))
		if !ok {
			return fmt.Errorf("host strategy could not parse go version output %q", strings.TrimSpace(string(out)))
		}
		required, ok := parseVersion(spec.GoVersion)
		if !ok {
			return fmt.Errorf("host strategy could not parse required Go version %q", spec.GoVersion)
		}
		if compareVersion(current, required) < 0 {
			toolchain, envErr := exec.Command("go", "env", "GOTOOLCHAIN").CombinedOutput()
			if envErr == nil && strings.Contains(strings.TrimSpace(string(toolchain)), "auto") {
				return nil
			}
			return fmt.Errorf("host strategy requires Go %s or newer; found %s. Install a newer Go toolchain or enable GOTOOLCHAIN=auto", spec.GoVersion, strings.TrimSpace(string(out)))
		}
	}
	for _, tool := range []string{"node", "npm"} {
		if _, err := exec.LookPath(tool); err != nil {
			return fmt.Errorf("host strategy requires %s; install Node.js/npm and ensure %s is on PATH", tool, tool)
		}
	}
	return nil
}

func parseGoVersion(output string) ([]int, bool) {
	for _, field := range strings.Fields(output) {
		if strings.HasPrefix(field, "go") && len(field) > len("go") {
			return parseVersion(strings.TrimPrefix(field, "go"))
		}
	}
	return nil, false
}

func parseVersion(version string) ([]int, bool) {
	version = strings.TrimPrefix(version, "go")
	parts := strings.Split(version, ".")
	if len(parts) == 0 {
		return nil, false
	}
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			return nil, false
		}
		digits := part
		for i, r := range part {
			if r < '0' || r > '9' {
				digits = part[:i]
				break
			}
		}
		if digits == "" {
			return nil, false
		}
		n, err := strconv.Atoi(digits)
		if err != nil {
			return nil, false
		}
		out = append(out, n)
	}
	return out, true
}

func compareVersion(left, right []int) int {
	maxLen := len(left)
	if len(right) > maxLen {
		maxLen = len(right)
	}
	for i := 0; i < maxLen; i++ {
		var l, r int
		if i < len(left) {
			l = left[i]
		}
		if i < len(right) {
			r = right[i]
		}
		if l < r {
			return -1
		}
		if l > r {
			return 1
		}
	}
	return 0
}

func isSinglePlatform(platform string) bool {
	return !strings.Contains(platform, ",")
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}
