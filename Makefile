.PHONY: build check replace up versions sandbox-create sandbox-start sandbox-shell sandbox-status sandbox-stop sandbox-validate

# Compose reads file selection, image/storage overrides and credentials from .env.
# No local configuration is required for the default Pi-only setup.

# Build from committed dependency inputs; Docker derives the runtime files.
build:
	docker compose build pi-box

# Sandbox commands are intentionally separate while Compose remains supported.
# No .env loading, implicit host mounts, recreation, pruning, or deletion.
sandbox-create sandbox-start sandbox-shell sandbox-status sandbox-stop sandbox-validate:
	node scripts/sandbox.mjs $(patsubst sandbox-%,%,$@)

versions:
	node scripts/check-versions.mjs

check:
	node scripts/check-container.mjs

# Preflight must precede every Compose command that could discard a container.
replace: check
	docker compose up -d --no-build --pull never --no-deps --force-recreate --wait --wait-timeout 60 pi-box

# Build first, then preflight; this stays sequential even with make -j.
up: build
	$(MAKE) check
	docker compose up -d --no-build --pull missing --wait --wait-timeout 60
