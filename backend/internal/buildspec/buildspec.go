package buildspec

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
)

type indexFile struct {
	Version    string      `json:"version"`
	Components []component `json:"components"`
}

type component struct {
	Name       string `json:"name"`
	ImportPath string `json:"importPath"`
}

type versionsFile struct {
	Versions []VersionInfo `json:"versions"`
}

type VersionInfo struct {
	Version       string `json:"version"`
	GoVersion     string `json:"goVersion"`
	BuildImageTag string `json:"buildImageTag"`
}

// Resolve maps Alloy component names to their Go import paths for version.
func Resolve(schemasFS fs.FS, version string, components []string) ([]string, error) {
	if schemasFS == nil {
		return nil, errors.New("schemasFS is required")
	}
	if version == "" {
		return nil, errors.New("version is required")
	}
	if len(components) == 0 {
		return nil, errors.New("at least one component is required")
	}

	data, err := fs.ReadFile(schemasFS, filepath.ToSlash(filepath.Join(version, "index.json")))
	if err != nil {
		return nil, fmt.Errorf("read schema index for %s: %w", version, err)
	}

	var index indexFile
	if err := json.Unmarshal(data, &index); err != nil {
		return nil, fmt.Errorf("decode schema index for %s: %w", version, err)
	}

	byName := make(map[string]string, len(index.Components))
	for _, component := range index.Components {
		byName[component.Name] = component.ImportPath
	}

	importSet := make(map[string]struct{}, len(components))
	missing := make([]string, 0)
	for _, name := range components {
		importPath, ok := byName[name]
		if !ok {
			missing = append(missing, name)
			continue
		}
		importSet[importPath] = struct{}{}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return nil, fmt.Errorf("unknown components for %s: %v", version, missing)
	}

	importPaths := make([]string, 0, len(importSet))
	for importPath := range importSet {
		importPaths = append(importPaths, importPath)
	}
	sort.Strings(importPaths)
	return importPaths, nil
}

func LookupVersion(schemasFS fs.FS, version string) (VersionInfo, error) {
	if schemasFS == nil {
		return VersionInfo{}, errors.New("schemasFS is required")
	}
	data, err := fs.ReadFile(schemasFS, "versions.json")
	if err != nil {
		return VersionInfo{}, fmt.Errorf("read versions.json: %w", err)
	}
	var versions versionsFile
	if err := json.Unmarshal(data, &versions); err != nil {
		return VersionInfo{}, fmt.Errorf("decode versions.json: %w", err)
	}
	for _, info := range versions.Versions {
		if info.Version == version {
			return info, nil
		}
	}
	return VersionInfo{}, fmt.Errorf("version %s not found in versions.json", version)
}
