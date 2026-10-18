.PHONY: build check replace attach up versions generate-db-credentials

# Compose reads file selection, image/storage overrides and credentials from .env.
# No local configuration is required for the default Pi-only setup.

# Refresh derived runtime files before Compose builds the image.
build:
	node container/prepare-runtime.mjs recommended
	node container/prepare-runtime.mjs base container/base
	npm --prefix container install --package-lock-only --ignore-scripts --no-audit --no-fund
	npm --prefix container/base install --package-lock-only --ignore-scripts --no-audit --no-fund
	docker compose build pi

versions:
	node scripts/check-versions.mjs

generate-db-credentials:
	node scripts/generate-db-credentials.mjs

check:
	node scripts/check-container.mjs

# Preflight must precede every Compose command that could discard a container.
replace: check
	docker compose up -d --no-build --pull never --no-deps --force-recreate --wait --wait-timeout 60 pi

attach:
	docker compose exec pi tmux attach-session -t '=shell'

# Build first, then preflight; this stays sequential even with make -j.
up: build
	$(MAKE) check
	docker compose up -d --no-build --pull missing --wait --wait-timeout 60
