.PHONY: sync-schemas frontend-build frontend-dev backend-build test lint

sync-schemas:
	rm -rf frontend/public/schemas
	cp -R schemas frontend/public/schemas

frontend-build: sync-schemas
	cd frontend && npm ci && npm run build
	rm -rf backend/internal/webui/dist
	cp -R frontend/dist backend/internal/webui/dist

frontend-dev: sync-schemas
	cd frontend && npm run dev

backend-build:
	cd backend && go build -o bin/custom-alloy-builder ./cmd/custom-alloy-builder
	cd backend && go build -o bin/buildctl ./cmd/buildctl

test:
	cd frontend && npm test
	cd backend && go test ./...

lint:
	cd frontend && npm run lint && npm run typecheck
	cd backend && go vet ./...
