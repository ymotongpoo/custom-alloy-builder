# custom-alloy-builder

custom-alloy-builder is a local-first tool for composing Grafana Alloy configurations and building custom Alloy distributions from selected components.

## Features

- Config builder: a React canvas for connecting Alloy components and exporting Alloy configuration. This runs fully in the browser.
- Binary builder: a local backend that clones Grafana Alloy, rewrites `internal/component/all/all.go` to include selected components, and builds a custom binary.
- Docker build strategy: builds Linux binaries inside Grafana's upstream Alloy build image.
- Host build strategy: runs `make alloy` directly on the local machine with `GOOS` and `GOARCH` set from the selected target.
- Container image output: for Docker builds, builds the upstream Alloy Dockerfile from the mutated workspace. Single-arch builds are loaded into local Docker; multi-arch builds are exported as an OCI tar.
- Versioned schemas: component metadata is generated from Alloy releases and drives the UI, serializer, and build import resolution.

## Pages vs Local

The GitHub Pages build is useful for composing and exporting Alloy configuration files. It does not have access to Docker, Go, local source clones, or your filesystem, so binary and image builds are unavailable there.

Run the local backend when you want to build a custom Alloy binary or image. The backend binds to `127.0.0.1`, serves the frontend, and runs local tools on your machine.

## Quickstart

```sh
make frontend-build backend-build
./backend/bin/custom-alloy-builder
```

Open the printed localhost URL in a browser.

For development:

```sh
cd frontend
npm ci
npm run dev
```

```sh
cd backend
go run ./cmd/custom-alloy-builder
```

Stop old Vite or backend processes before starting new ones if ports are already in use.

## Requirements

- Docker with Buildx for Docker strategy builds and image output.
- Go for backend development and host strategy builds.
- Node.js and npm for frontend development and host strategy builds.
- Git for fetching Alloy source releases.
- At least 10 GB of free disk space. Fresh Alloy clones, Go module downloads, build cache, and Docker layers can be large.

The build pipeline places temporary files under the workspace or cache root instead of `/tmp` where possible. This matters on systems where `/tmp` is a small tmpfs.

## Security

The local server is intentionally unauthenticated and intended for single-user localhost use. It binds to `127.0.0.1` by default and can run local tools such as Git, Go, npm, Docker, and `make` through build requests. Do not expose it on a public or shared network.

## Architecture

Schema generation starts from a Grafana Alloy release tag. `generator/run-generator.sh <version>` clones Alloy, injects the schema generator into the clone, imports Alloy's component registry, and writes JSON schemas under `schemas/<version>/` plus release metadata in `schemas/versions.json`.

The frontend lazy-loads schemas for the selected Alloy version. The config builder turns graph state into an intermediate representation, then serializes that IR into Alloy configuration. Golden fixtures in `testdata/golden/` verify serializer output.

The local backend serves the frontend and exposes build APIs. A build request resolves selected component names to import paths, prepares a mutable Alloy workspace from the cached release clone, rewrites Alloy's component registry import file, and dispatches to an executor:

- Docker executor: runs `make alloy` inside `grafana/alloy-build-image:<tag>` for binary output, or runs `docker buildx build` against the mutated workspace for image output.
- Host executor: checks local Go, Node.js, and npm, then runs `make alloy` directly with target `GOOS` and `GOARCH`.

Artifacts are stored under the local cache. Binary and multi-arch OCI outputs are downloadable. Single-arch image output is loaded into the local Docker daemon with a tag like `alloy-custom:<version>-<jobID>`.

## macOS Darwin Build Demo

On macOS, install Go, Node.js/npm, Git, and the usual Alloy build prerequisites. Then run the local backend:

```sh
make frontend-build backend-build
./backend/bin/custom-alloy-builder
```

In the Binary Builder:

1. Select an Alloy version.
2. Select one or more components.
3. Choose `Host` strategy.
4. Choose `Binary` output.
5. Build for this machine.

The host strategy runs `make alloy` with `GOOS=darwin` and the detected local architecture. After downloading the artifact, verify it:

```sh
chmod +x alloy-custom-*-darwin-*
./alloy-custom-*-darwin-* --version
```

## Repository Layout

```text
frontend/    React + TypeScript + Vite UI
backend/     Go backend and build executors
generator/   Schema generator injected into Alloy clones
schemas/     Generated component schemas per Alloy version
testdata/    Golden Alloy and IR fixtures
docs/        Plans and decision records
```

## License

Apache License 2.0. See [LICENSE](LICENSE).

The River serializer is adapted from [grafana/alloy-configurator](https://github.com/grafana/alloy-configurator) (Apache-2.0). See [NOTICE](NOTICE).
