package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/api"
	"github.com/ymotongpoo/custom-alloy-builder/backend/internal/webui"
)

func main() {
	addr := flag.String("addr", ":8085", "HTTP listen address")
	flag.Parse()

	server := &http.Server{
		Addr:    *addr,
		Handler: api.NewHandler(webui.FS),
	}

	log.Printf("listening on %s", *addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
