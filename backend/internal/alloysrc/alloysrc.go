package alloysrc

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const alloyRepo = "https://github.com/grafana/alloy"

// Ensure returns a cached Alloy source checkout for version, cloning it if needed.
func Ensure(cacheRoot, version string) (string, error) {
	if cacheRoot == "" {
		return "", errors.New("cache root is required")
	}
	if version == "" {
		return "", errors.New("version is required")
	}

	dir := filepath.Join(cacheRoot, "src", "alloy-"+version)
	if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
		return dir, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("check cached source: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return "", fmt.Errorf("create source cache dir: %w", err)
	}

	cmd := exec.Command("git", "clone", "--depth", "1", "--branch", version, alloyRepo, dir)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("clone alloy %s: %w: %s", version, err, stderr.String())
	}
	return dir, nil
}

// PrepareWorkspace copies cloneDir into workDir.
func PrepareWorkspace(cloneDir, workDir string) error {
	if cloneDir == "" || workDir == "" {
		return errors.New("cloneDir and workDir are required")
	}
	if err := os.RemoveAll(workDir); err != nil {
		return fmt.Errorf("clear workspace: %w", err)
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return fmt.Errorf("create workspace: %w", err)
	}

	return filepath.WalkDir(cloneDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(cloneDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		dst := filepath.Join(workDir, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		mode := info.Mode()
		if d.IsDir() {
			return os.MkdirAll(dst, mode.Perm())
		}
		if mode.Type()&os.ModeSymlink != 0 {
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(target, dst)
		}
		if !mode.IsRegular() {
			return nil
		}
		return copyFile(path, dst, mode.Perm())
	})
}

// RewriteAll writes internal/component/all/all.go with only the requested blank imports.
func RewriteAll(workDir string, importPaths []string) error {
	if workDir == "" {
		return errors.New("workDir is required")
	}
	paths := uniqueSorted(importPaths)
	if len(paths) == 0 {
		return errors.New("at least one import path is required")
	}

	var buf bytes.Buffer
	buf.WriteString("// Package all imports selected component packages.\n")
	buf.WriteString("package all\n\n")
	buf.WriteString("import (\n")
	for _, path := range paths {
		fmt.Fprintf(&buf, "\t_ %q\n", path)
	}
	buf.WriteString(")\n")

	allPath := filepath.Join(workDir, "internal", "component", "all", "all.go")
	if err := os.MkdirAll(filepath.Dir(allPath), 0o755); err != nil {
		return fmt.Errorf("create all.go dir: %w", err)
	}
	if err := os.WriteFile(allPath, buf.Bytes(), 0o644); err != nil {
		return fmt.Errorf("write all.go: %w", err)
	}
	if err := rewriteConverterLocalFile(workDir); err != nil {
		return err
	}
	return nil
}

const localFileImport = `"github.com/grafana/alloy/internal/component/local/file"`

func rewriteConverterLocalFile(workDir string) error {
	path := filepath.Join(workDir, "internal", "converter", "internal", "otelcolconvert", "converter_bearertokenauthextension.go")
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read bearer token converter: %w", err)
	}
	text := string(data)
	if !strings.Contains(text, localFileImport) {
		// Upstream no longer imports local.file here; nothing to patch.
		return nil
	}
	for _, rep := range []struct{ old, new string }{
		{
			localFileImport,
			`filedetector "github.com/grafana/alloy/internal/filedetector"`,
		},
		{
			"type bearerTokenAuthExtensionConverter struct{}\n",
			"type bearerTokenAuthExtensionConverter struct{}\n\n" +
				"type localFileArguments struct {\n" +
				"\tFilename      string                `alloy:\"filename,attr\"`\n" +
				"\tType          filedetector.Detector `alloy:\"detector,attr,optional\"`\n" +
				"\tPollFrequency time.Duration         `alloy:\"poll_frequency,attr,optional\"`\n" +
				"\tIsSecret      bool                  `alloy:\"is_secret,attr,optional\"`\n" +
				"}\n",
		},
		{"&file.Arguments{", "&localFileArguments{"},
		{"file.DefaultArguments.Type", "filedetector.DetectorFSNotify"},
	} {
		if !strings.Contains(text, rep.old) {
			return fmt.Errorf("patch bearer token converter: pattern %q not found; the upstream file changed and the local.file patch must be updated for this Alloy version", rep.old)
		}
		text = strings.ReplaceAll(text, rep.old, rep.new)
	}
	if strings.Contains(text, localFileImport) {
		return fmt.Errorf("patch bearer token converter: local.file import still present after patching")
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		return fmt.Errorf("write bearer token converter: %w", err)
	}
	return nil
}

func copyFile(src, dst string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func uniqueSorted(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
