package api

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/buildspec"
	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/jobs"
)

type Options struct {
	SchemaRoot string
	Queue      *jobs.Queue
}

type handler struct {
	schemasFS fs.FS
	queue     *jobs.Queue
}

func NewHandler(webFS fs.FS, options ...Options) http.Handler {
	var opts Options
	if len(options) > 0 {
		opts = options[0]
	}
	schemaRoot := opts.SchemaRoot
	if schemaRoot == "" {
		schemaRoot, _ = FindSchemasDir("")
	}
	queue := opts.Queue
	if queue == nil {
		var err error
		queue, err = jobs.NewQueue(jobs.Options{})
		if err != nil {
			return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			})
		}
	}
	h := &handler{
		schemasFS: os.DirFS(schemaRoot),
		queue:     queue,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/healthz", healthz)
	mux.HandleFunc("GET /api/v1/versions", h.versions)
	mux.HandleFunc("GET /api/v1/versions/{version}/components", h.components)
	mux.HandleFunc("POST /api/v1/builds", h.createBuild)
	mux.HandleFunc("GET /api/v1/builds/{id}", h.getBuild)
	mux.HandleFunc("GET /api/v1/builds/{id}/logs", h.buildLogs)
	mux.HandleFunc("GET /api/v1/builds/{id}/artifacts/{name}", h.downloadArtifact)
	mux.HandleFunc("/", staticHandler(webFS))
	return mux
}

func healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func FindSchemasDir(flagValue string) (string, error) {
	if flagValue != "" {
		if _, err := os.Stat(filepath.Join(flagValue, "versions.json")); err != nil {
			return "", err
		}
		return flagValue, nil
	}
	exe, _ := os.Executable()
	candidates := []string{"schemas", "../schemas"}
	if exe != "" {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, "schemas"),
			filepath.Join(exeDir, "..", "schemas"),
			filepath.Join(exeDir, "..", "..", "schemas"),
		)
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(filepath.Join(candidate, "versions.json")); err == nil {
			return candidate, nil
		}
	}
	return "", os.ErrNotExist
}

func (h *handler) versions(w http.ResponseWriter, _ *http.Request) {
	serveJSONFile(w, h.schemasFS, "versions.json")
}

func (h *handler) components(w http.ResponseWriter, r *http.Request) {
	version := r.PathValue("version")
	if version == "" || strings.Contains(version, "/") {
		http.Error(w, "invalid version", http.StatusBadRequest)
		return
	}
	serveJSONFile(w, h.schemasFS, filepath.ToSlash(filepath.Join(version, "index.json")))
}

type createBuildRequest struct {
	Version    string        `json:"version"`
	Components []string      `json:"components"`
	Targets    []jobs.Target `json:"targets"`
	Output     string        `json:"output"`
	Strategy   string        `json:"strategy"`
}

func (h *handler) createBuild(w http.ResponseWriter, r *http.Request) {
	var req createBuildRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	versionInfo, err := buildspec.LookupVersion(h.schemasFS, req.Version)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	importPaths, err := buildspec.Resolve(h.schemasFS, req.Version, req.Components)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	job, err := h.queue.Enqueue(jobs.Request{
		Version:        req.Version,
		ComponentNames: req.Components,
		ImportPaths:    importPaths,
		Targets:        req.Targets,
		Output:         req.Output,
		Strategy:       req.Strategy,
		VersionInfo:    versionInfo,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": job.ID()})
}

func (h *handler) getBuild(w http.ResponseWriter, r *http.Request) {
	job, ok := h.queue.Get(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, job.Snapshot())
}

func (h *handler) buildLogs(w http.ResponseWriter, r *http.Request) {
	job, ok := h.queue.Get(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	existing, ch, done, cancel := job.Subscribe()
	defer cancel()
	for _, line := range existing {
		writeSSE(w, "log", line)
	}
	flusher.Flush()
	for {
		select {
		case line, ok := <-ch:
			if !ok {
				writeSSE(w, "done", string(job.Snapshot().Status))
				flusher.Flush()
				return
			}
			writeSSE(w, "log", line)
			flusher.Flush()
		case <-done:
			writeSSE(w, "done", string(job.Snapshot().Status))
			flusher.Flush()
			return
		case <-r.Context().Done():
			return
		}
	}
}

func (h *handler) downloadArtifact(w http.ResponseWriter, r *http.Request) {
	job, ok := h.queue.Get(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	artifactPath, ok := job.ArtifactPath(r.PathValue("name"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(artifactPath)+`"`)
	http.ServeFile(w, r, artifactPath)
}

func staticHandler(webFS fs.FS) http.HandlerFunc {
	dist, err := fs.Sub(webFS, "dist")
	if err != nil {
		return func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "web UI unavailable", http.StatusInternalServerError)
		}
	}

	fileServer := http.FileServer(http.FS(dist))
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			data, err := fs.ReadFile(dist, "index.html")
			if err != nil {
				http.Error(w, "web UI unavailable", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(data)
			return
		}
		r.URL.Path = path.Clean(r.URL.Path)
		fileServer.ServeHTTP(w, r)
	}
}

func serveJSONFile(w http.ResponseWriter, root fs.FS, name string) {
	data, err := fs.ReadFile(root, name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeSSE(w http.ResponseWriter, event, data string) {
	_, _ = w.Write([]byte("event: " + event + "\n"))
	for _, line := range strings.Split(data, "\n") {
		_, _ = w.Write([]byte("data: " + line + "\n"))
	}
	_, _ = w.Write([]byte("\n"))
}
