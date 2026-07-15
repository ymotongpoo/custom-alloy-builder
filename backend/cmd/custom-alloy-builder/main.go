package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/api"
	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/webui"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8085", "HTTP listen address")
	schemaRoot := flag.String("schema-root", "", "schemas directory")
	flag.Parse()

	schemasDir, err := api.FindSchemasDir(*schemaRoot)
	if err != nil {
		log.Fatalf("schemas directory not found; pass -schema-root: %v", err)
	}
	server := &http.Server{
		Addr:    *addr,
		Handler: api.NewHandler(webui.FS, api.Options{SchemaRoot: schemasDir}),
	}

	log.Printf("listening on %s", *addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
