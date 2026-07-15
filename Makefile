.PHONY: frontend-build backend-build test lint

frontend-build:
	cd frontend && npm ci && npm run build
	rm -rf backend/internal/webui/dist
	cp -R frontend/dist backend/internal/webui/dist

backend-build:
	cd backend && go build -o bin/custom-alloy-builder ./cmd/...

test:
	cd frontend && npm test
	cd backend && go test ./...

lint:
	cd frontend && npm run lint && npm run typecheck
	cd backend && go vet ./...
