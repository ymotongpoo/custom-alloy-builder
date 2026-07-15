package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"

	"github.com/grafana/alloy/internal/component"
	_ "github.com/grafana/alloy/internal/component/all"
	"github.com/grafana/alloy/internal/featuregate"
)

func main() {
	outDir := flag.String("out", "", "output directory")
	version := flag.String("version", "", "Alloy version")
	flag.Parse()
	if *outDir == "" {
		fatalf("-out is required")
	}
	if *version == "" {
		*version = filepath.Base(filepath.Clean(*outDir))
	}

	names := component.AllNames()
	sort.Strings(names)
	components := make([]ComponentSchema, 0, len(names))
	index := IndexSchema{Version: *version, Components: make([]ComponentIndex, 0, len(names))}

	for _, name := range names {
		reg, ok := component.Get(name)
		if !ok {
			warnf("registered component %s disappeared", name)
			continue
		}
		schema := ComponentSchema{
			Name:       reg.Name,
			ImportPath: importPathForBuild(reg.Build),
			Stability:  stabilityString(reg.Stability),
			Community:  reg.Community,
			Arguments:  bodyForType(reflect.TypeOf(reg.Args)),
			Exports:    bodyForType(reflect.TypeOf(reg.Exports)),
		}
		components = append(components, schema)
		index.Components = append(index.Components, ComponentIndex{
			Name:       schema.Name,
			Stability:  schema.Stability,
			Community:  schema.Community,
			ImportPath: schema.ImportPath,
			Inputs:     collectCapsules(schema.Arguments, true),
			Outputs:    collectCapsules(schema.Exports, false),
		})
	}

	if err := os.RemoveAll(*outDir); err != nil {
		fatalf("remove output directory: %v", err)
	}
	componentDir := filepath.Join(*outDir, "components")
	if err := os.MkdirAll(componentDir, 0o755); err != nil {
		fatalf("create component directory: %v", err)
	}
	for _, schema := range components {
		path := filepath.Join(componentDir, schema.Name+".json")
		if err := writeJSON(path, schema); err != nil {
			fatalf("write %s: %v", path, err)
		}
	}
	if err := writeJSON(filepath.Join(*outDir, "index.json"), index); err != nil {
		fatalf("write index: %v", err)
	}
}

func importPathForBuild(build any) string {
	if build == nil {
		return ""
	}
	name := runtime.FuncForPC(reflect.ValueOf(build).Pointer()).Name()
	for _, marker := range []string{".init.", ".init$", ".New", ".NewComponent"} {
		if idx := strings.Index(name, marker); idx > 0 {
			return name[:idx]
		}
	}
	if idx := strings.LastIndex(name, "."); idx > 0 {
		return name[:idx]
	}
	return name
}

func stabilityString(stability featuregate.Stability) string {
	switch stability {
	case featuregate.StabilityExperimental:
		return "experimental"
	case featuregate.StabilityPublicPreview:
		return "public-preview"
	case featuregate.StabilityGenerallyAvailable:
		return "generally-available"
	default:
		return "undefined"
	}
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "error: "+format+"\n", args...)
	os.Exit(1)
}
