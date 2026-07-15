# custom-alloy-builder

A web UI for building custom [Grafana Alloy](https://github.com/grafana/alloy) distributions and configurations:

- **Config builder** — visually connect Alloy components on a canvas and export an Alloy (River) configuration file. Runs fully client-side; hosted on GitHub Pages.
- **Binary builder** — pick the components you need and build a custom Alloy binary containing only those components. Requires running the tool locally (Go backend orchestrating Docker or host-native builds).

Status: pre-v0.1, under active development. See [docs/plans/](docs/plans/) for the implementation plan and [docs/decisions/](docs/decisions/) for design decisions.

## Repository layout

```
frontend/    React + TypeScript + Vite + React Flow web UI
backend/     Go backend (serves embedded frontend, runs builds)
generator/   Schema generator (run inside a grafana/alloy source clone)
schemas/     Pre-generated component JSON schemas per Alloy version
docs/        Plans and decision records
```

## License

Apache License 2.0. See [LICENSE](LICENSE).

The River serializer is adapted from [grafana/alloy-configurator](https://github.com/grafana/alloy-configurator) (Apache-2.0). See [NOTICE](NOTICE).
