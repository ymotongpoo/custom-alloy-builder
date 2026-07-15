package alloysrc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRewriteAll(t *testing.T) {
	workDir := t.TempDir()

	importPaths := []string{
		"github.com/grafana/alloy/internal/component/prometheus/scrape",
		"github.com/grafana/alloy/internal/component/loki/write",
		"github.com/grafana/alloy/internal/component/prometheus/scrape",
	}
	if err := RewriteAll(workDir, importPaths); err != nil {
		t.Fatalf("RewriteAll() error = %v", err)
	}

	got, err := os.ReadFile(filepath.Join(workDir, "internal", "component", "all", "all.go"))
	if err != nil {
		t.Fatalf("read all.go: %v", err)
	}

	want := `// Package all imports selected component packages.
package all

import (
	_ "github.com/grafana/alloy/internal/component/loki/write"
	_ "github.com/grafana/alloy/internal/component/prometheus/scrape"
)
`
	if string(got) != want {
		t.Fatalf("all.go mismatch\nwant:\n%s\ngot:\n%s", want, got)
	}
}

func writeConverterFixture(t *testing.T, workDir, content string) string {
	t.Helper()
	path := filepath.Join(workDir, "internal", "converter", "internal", "otelcolconvert", "converter_bearertokenauthextension.go")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestRewriteConverterLocalFile(t *testing.T) {
	imports := []string{"github.com/grafana/alloy/internal/component/loki/write"}

	t.Run("patches known shape", func(t *testing.T) {
		workDir := t.TempDir()
		path := writeConverterFixture(t, workDir, `package otelcolconvert

import (
	"github.com/grafana/alloy/internal/component/local/file"
)

type bearerTokenAuthExtensionConverter struct{}

func x() {
	_ = &file.Arguments{Type: file.DefaultArguments.Type}
}
`)
		if err := RewriteAll(workDir, imports); err != nil {
			t.Fatalf("RewriteAll() error = %v", err)
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(got), "internal/component/local/file") {
			t.Fatalf("local.file import survived the patch:\n%s", got)
		}
		if !strings.Contains(string(got), "localFileArguments") {
			t.Fatalf("replacement struct missing:\n%s", got)
		}
	})

	t.Run("errors when upstream shape changed", func(t *testing.T) {
		workDir := t.TempDir()
		writeConverterFixture(t, workDir, `package otelcolconvert

import (
	"github.com/grafana/alloy/internal/component/local/file"
)

type renamedConverter struct{}

var _ = file.Arguments{}
`)
		if err := RewriteAll(workDir, imports); err == nil {
			t.Fatal("RewriteAll() should fail when the converter no longer matches the patch patterns")
		}
	})

	t.Run("no-op when import already gone", func(t *testing.T) {
		workDir := t.TempDir()
		writeConverterFixture(t, workDir, "package otelcolconvert\n\ntype bearerTokenAuthExtensionConverter struct{}\n")
		if err := RewriteAll(workDir, imports); err != nil {
			t.Fatalf("RewriteAll() error = %v", err)
		}
	})
}
