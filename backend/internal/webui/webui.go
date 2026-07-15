package webui

import "embed"

// CI copies frontend/dist into this directory before backend builds.
//
//go:embed dist
var FS embed.FS
