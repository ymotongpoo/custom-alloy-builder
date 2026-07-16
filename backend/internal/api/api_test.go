package api

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/executor"
	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/jobs"
)

//go:embed testdata/dist/index.html
var testWebFS embed.FS

func TestHealthz(t *testing.T) {
	handler := newTestHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", rec.Code, http.StatusOK)
	}
	if got, want := rec.Body.String(), "{\"status\":\"ok\"}\n"; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
}

func TestVersionsAndComponents(t *testing.T) {
	handler := newTestHandler(t)
	for _, path := range []string{"/api/v1/versions", "/api/v1/versions/v1.17.1/components"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200: %s", path, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "v1.17.1") {
			t.Fatalf("%s body = %s, want version", path, rec.Body.String())
		}
	}
}

func TestCreateBuildValidation(t *testing.T) {
	handler := newTestHandler(t)
	tests := []struct {
		name string
		body string
	}{
		{
			name: "unknown component",
			body: `{"version":"v1.17.1","components":["missing.component"],"targets":[{"os":"linux","arch":"amd64"}],"output":"binary","strategy":"docker"}`,
		},
		{
			name: "docker non linux",
			body: `{"version":"v1.17.1","components":["prometheus.scrape"],"targets":[{"os":"darwin","arch":"amd64"}],"output":"binary","strategy":"docker"}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/builds", strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestCreateBuildAndSSE(t *testing.T) {
	handler := newTestHandler(t)
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/builds",
		strings.NewReader(`{"version":"v1.17.1","components":["prometheus.scrape"],"targets":[{"os":"linux","arch":"amd64"}],"output":"binary","strategy":"docker"}`),
	)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202: %s", rec.Code, rec.Body.String())
	}
	id := strings.TrimSpace(strings.Split(strings.Split(rec.Body.String(), `"`)[3], `"`)[0])
	if id == "" {
		t.Fatalf("missing id in %s", rec.Body.String())
	}

	server := httptest.NewServer(handler)
	defer server.Close()
	client := server.Client()
	sseReq, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/builds/"+id+"/logs", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Do(sseReq)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("SSE status = %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, "event: log") || !strings.Contains(text, "event: done") {
		t.Fatalf("SSE stream = %q, want log and done events", text)
	}

	waitForBuildStatus(t, handler, id, "done")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/builds/"+id, nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("build status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var snapshot jobs.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Artifacts) != 1 {
		t.Fatalf("artifacts = %v, want 1", snapshot.Artifacts)
	}
	if !filepath.IsAbs(snapshot.Artifacts[0].Path) {
		t.Fatalf("artifact path = %q, want absolute path", snapshot.Artifacts[0].Path)
	}
}

func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	schemaRoot := t.TempDir()
	if err := os.MkdirAll(filepath.Join(schemaRoot, "v1.17.1"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(schemaRoot, "versions.json"), `{"versions":[{"version":"v1.17.1","goVersion":"1.26.4","buildImageTag":"v0.1.33"}]}`)
	mustWrite(t, filepath.Join(schemaRoot, "v1.17.1", "index.json"), `{"version":"v1.17.1","components":[{"name":"prometheus.scrape","importPath":"github.com/grafana/alloy/internal/component/prometheus/scrape"}]}`)
	root := t.TempDir()
	queue, err := jobs.NewQueue(jobs.Options{
		CacheRoot:     filepath.Join(root, "cache"),
		WorkspaceRoot: filepath.Join(root, "work"),
		ArtifactRoot:  filepath.Join(root, "artifacts"),
		Source:        fakeSource{},
		Docker:        fakeExecutor{},
	})
	if err != nil {
		t.Fatal(err)
	}
	return NewHandler(testWebFS, Options{SchemaRoot: schemaRoot, Queue: queue})
}

func mustWrite(t *testing.T, path, text string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
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
	_, _ = logs.Write([]byte("executor log\n"))
	time.Sleep(10 * time.Millisecond)
	return os.WriteFile(spec.OutputPath, []byte("artifact"), 0o755)
}

func waitForBuildStatus(t *testing.T, handler http.Handler, id, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/builds/"+id, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code == http.StatusOK && bytes.Contains(rec.Body.Bytes(), []byte(`"status":"`+want+`"`)) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("build %s did not reach %s", id, want)
}
