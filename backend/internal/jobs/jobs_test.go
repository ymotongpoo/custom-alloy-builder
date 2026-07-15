package jobs

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/buildspec"
	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/executor"
)

func TestQueueRunsJobTransitionsAndArtifacts(t *testing.T) {
	queue := newTestQueue(t)
	job, err := queue.Enqueue(Request{
		Version:     "v1.17.1",
		ImportPaths: []string{"github.com/grafana/alloy/internal/component/prometheus/scrape"},
		Targets:     []Target{{OS: "linux", Arch: "amd64"}},
		Output:      "binary",
		Strategy:    "docker",
		VersionInfo: buildspec.VersionInfo{Version: "v1.17.1", BuildImageTag: "v0.1.33"},
	})
	if err != nil {
		t.Fatalf("Enqueue() error = %v", err)
	}

	waitForStatus(t, job, StatusDone)
	snapshot := job.Snapshot()
	if len(snapshot.Artifacts) != 1 {
		t.Fatalf("artifacts = %v, want 1", snapshot.Artifacts)
	}
	if snapshot.Artifacts[0].Size == 0 {
		t.Fatal("artifact size = 0, want non-zero")
	}
	if snapshot.Artifacts[0].Kind != "binary" {
		t.Fatalf("artifact kind = %q, want binary", snapshot.Artifacts[0].Kind)
	}
}

func TestQueueRunsImageJobAsLoadedDockerImage(t *testing.T) {
	queue := newTestQueue(t)
	job, err := queue.Enqueue(Request{
		Version:     "v1.17.1",
		ImportPaths: []string{"github.com/grafana/alloy/internal/component/prometheus/scrape"},
		Targets:     []Target{{OS: "linux", Arch: "amd64"}},
		Output:      "image",
		Strategy:    "docker",
		VersionInfo: buildspec.VersionInfo{Version: "v1.17.1", BuildImageTag: "v0.1.33"},
	})
	if err != nil {
		t.Fatalf("Enqueue() error = %v", err)
	}

	waitForStatus(t, job, StatusDone)
	snapshot := job.Snapshot()
	if len(snapshot.Artifacts) != 1 {
		t.Fatalf("artifacts = %v, want 1", snapshot.Artifacts)
	}
	if snapshot.Artifacts[0].Kind != "image" {
		t.Fatalf("artifact kind = %q, want image", snapshot.Artifacts[0].Kind)
	}
	if snapshot.Artifacts[0].Name == "" {
		t.Fatal("image tag is empty")
	}
}

func TestSubscribeReplaysExistingLogsAndStreamsNewLogs(t *testing.T) {
	queue := newTestQueue(t)
	job, err := queue.Enqueue(Request{
		Version:     "v1.17.1",
		ImportPaths: []string{"github.com/grafana/alloy/internal/component/prometheus/scrape"},
		Targets:     []Target{{OS: "linux", Arch: "amd64"}},
		Output:      "binary",
		Strategy:    "docker",
		VersionInfo: buildspec.VersionInfo{Version: "v1.17.1", BuildImageTag: "v0.1.33"},
	})
	if err != nil {
		t.Fatalf("Enqueue() error = %v", err)
	}

	waitForStatus(t, job, StatusDone)
	existing, _, done, cancel := job.Subscribe()
	defer cancel()
	if len(existing) == 0 {
		t.Fatal("existing logs empty")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("done channel was not closed")
	}
}

func newTestQueue(t *testing.T) *Queue {
	t.Helper()
	root := t.TempDir()
	queue, err := NewQueue(Options{
		CacheRoot:     filepath.Join(root, "cache"),
		WorkspaceRoot: filepath.Join(root, "work"),
		ArtifactRoot:  filepath.Join(root, "artifacts"),
		Source:        fakeSource{},
		Docker:        fakeExecutor{},
		LogLimit:      20,
	})
	if err != nil {
		t.Fatalf("NewQueue() error = %v", err)
	}
	return queue
}

type fakeSource struct{}

func (fakeSource) Ensure(cacheRoot, version string) (string, error) {
	dir := filepath.Join(cacheRoot, "src", version)
	return dir, os.MkdirAll(dir, 0o755)
}

func (fakeSource) PrepareWorkspace(_, workDir string) error {
	return os.MkdirAll(workDir, 0o755)
}

func (fakeSource) RewriteAll(_ string, _ []string) error {
	return nil
}

type fakeExecutor struct{}

func (fakeExecutor) Build(_ context.Context, spec executor.Spec, logs io.Writer) error {
	_, _ = logs.Write([]byte("fake build log\n"))
	return os.WriteFile(spec.OutputPath, []byte("#!/bin/sh\necho fake alloy\n"), 0o755)
}

func waitForStatus(t *testing.T, job *Job, want Status) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if got := job.Snapshot().Status; got == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("status = %s, want %s", job.Snapshot().Status, want)
}
