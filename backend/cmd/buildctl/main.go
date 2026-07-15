package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/alloysrc"
	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/buildspec"
	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/executor"
)

func main() {
	version := flag.String("version", "v1.17.1", "Alloy version to build")
	components := flag.String("components", "", "comma-separated Alloy component names")
	output := flag.String("o", "build/alloy-custom", "output binary path")
	goos := flag.String("goos", "linux", "target GOOS")
	goarch := flag.String("goarch", "amd64", "target GOARCH")
	cacheRoot := flag.String("cache-root", defaultCacheRoot(), "cache root")
	workspaceRoot := flag.String("workspace-root", "", "workspace root")
	schemaRoot := flag.String("schema-root", "", "schemas directory")
	strategy := flag.String("strategy", "docker", "build strategy")
	flag.Parse()

	if *strategy != "docker" {
		log.Fatalf("unsupported strategy %q", *strategy)
	}

	componentNames := splitCSV(*components)
	if len(componentNames) == 0 {
		log.Fatal("-components is required")
	}

	schemasDir, err := findSchemasDir(*schemaRoot)
	if err != nil {
		log.Fatal(err)
	}
	schemasFS := os.DirFS(schemasDir)

	importPaths, err := buildspec.Resolve(schemasFS, *version, componentNames)
	if err != nil {
		log.Fatal(err)
	}
	versionInfo, err := buildspec.LookupVersion(schemasFS, *version)
	if err != nil {
		log.Fatal(err)
	}

	cloneDir, err := alloysrc.Ensure(*cacheRoot, *version)
	if err != nil {
		log.Fatal(err)
	}

	root := *workspaceRoot
	if root == "" {
		root = filepath.Join(*cacheRoot, "workspaces")
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		log.Fatal(err)
	}
	workDir := filepath.Join(root, fmt.Sprintf("alloy-%s-%d", *version, time.Now().UnixNano()))
	log.Printf("preparing workspace %s", workDir)
	if err := alloysrc.PrepareWorkspace(cloneDir, workDir); err != nil {
		log.Fatal(err)
	}
	if err := alloysrc.RewriteAll(workDir, importPaths); err != nil {
		log.Fatal(err)
	}

	spec := executor.Spec{
		Version:       *version,
		WorkDir:       workDir,
		GOOS:          *goos,
		GOARCH:        *goarch,
		OutputPath:    *output,
		BuildImageTag: versionInfo.BuildImageTag,
	}
	log.Printf("building Alloy %s for %s/%s with grafana/alloy-build-image:%s", *version, *goos, *goarch, versionInfo.BuildImageTag)
	if err := (executor.DockerExecutor{}).Build(context.Background(), spec, os.Stdout); err != nil {
		log.Fatal(err)
	}
	log.Printf("wrote %s", *output)
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func defaultCacheRoot() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".cache/custom-alloy-builder"
	}
	return filepath.Join(home, ".cache", "custom-alloy-builder")
}

func findSchemasDir(flagValue string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	candidates := []string{"schemas", "../schemas"}
	for _, candidate := range candidates {
		if _, err := os.Stat(filepath.Join(candidate, "versions.json")); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("schemas directory not found; pass -schema-root")
}
