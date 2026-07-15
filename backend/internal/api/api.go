package api

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
)

func NewHandler(webFS fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/healthz", healthz)
	mux.HandleFunc("/", staticHandler(webFS))
	return mux
}

func healthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
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
			r.URL.Path = "/index.html"
		} else {
			r.URL.Path = path.Clean(r.URL.Path)
		}
		fileServer.ServeHTTP(w, r)
	}
}
