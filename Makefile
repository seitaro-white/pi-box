.PHONY: build check replace attach up versions

# Compose reads file selection, image/storage overrides and credentials from .env.
# No local configuration is required for the default Pi-only setup.

# Build from committed dependency inputs; Docker derives the runtime files.
build:
	docker compose build pi-box

versions:
	node scripts/check-versions.mjs

check:
	node scripts/check-container.mjs

# Preflight must precede every Compose command that could discard a container.
replace: check
	docker compose up -d --no-build --pull never --no-deps --force-recreate --wait --wait-timeout 60 pi-box

attach:
	docker compose exec pi-box tmux attach-session -t '=shell'

# Build first, then preflight; this stays sequential even with make -j.
up: build
	$(MAKE) check
	docker compose up -d --no-build --pull missing --wait --wait-timeout 60
