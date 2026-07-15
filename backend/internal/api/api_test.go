package api

import (
	"embed"
	"net/http"
	"net/http/httptest"
	"testing"
)

//go:embed testdata/dist/index.html
var testWebFS embed.FS

func TestHealthz(t *testing.T) {
	handler := NewHandler(testWebFS)
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
