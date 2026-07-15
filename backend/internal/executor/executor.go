package executor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

type Spec struct {
	Version       string
	WorkDir       string
	CacheRoot     string
	GOOS          string
	GOARCH        string
	OutputPath    string
	BuildImageTag string
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
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create container cache dir: %w", err)
		}
	}
	absCacheRoot, err := filepath.Abs(cacheRoot)
	if err != nil {
		return fmt.Errorf("resolve cache root: %w", err)
	}

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

func (HostExecutor) Build(ctx context.Context, spec Spec, logs io.Writer) error {
	if err := validateSpec(spec); err != nil {
		return err
	}
	if spec.GOOS != runtime.GOOS || spec.GOARCH != runtime.GOARCH {
		return fmt.Errorf("host executor can only build for %s/%s", runtime.GOOS, runtime.GOARCH)
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
	if spec.BuildImageTag == "" {
		return errors.New("BuildImageTag is required")
	}
	return nil
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
