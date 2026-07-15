package buildspec

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestResolve(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "v1"), 0o755); err != nil {
		t.Fatal(err)
	}
	index := `{"version":"v1","components":[{"name":"b","importPath":"example.com/b"},{"name":"a","importPath":"example.com/a"}]}`
	if err := os.WriteFile(filepath.Join(dir, "v1", "index.json"), []byte(index), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := Resolve(os.DirFS(dir), "v1", []string{"b", "a", "b"})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	want := []string{"example.com/a", "example.com/b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Resolve() = %v, want %v", got, want)
	}
}

func TestResolveUnknown(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "v1"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "v1", "index.json"), []byte(`{"components":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := Resolve(os.DirFS(dir), "v1", []string{"missing"}); err == nil {
		t.Fatal("Resolve() error = nil, want unknown component error")
	}
}
