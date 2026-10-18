.PHONY: build runtime check replace migrate attach up versions

IMAGE ?= pi-box:0.2.0
TARGET ?= recommended
CONTAINER ?= pi-box-dev
WORKSPACE_VOLUME ?= pi-box-workspace
AGENT_VOLUME ?= pi-box-agent
GIT_VOLUME ?= pi-box-git
export IMAGE TARGET CONTAINER WORKSPACE_VOLUME AGENT_VOLUME GIT_VOLUME

# Refresh derived runtime files before Compose builds the image.
build: runtime
	docker compose build pi

runtime:
	node container/prepare-runtime.mjs recommended
	node container/prepare-runtime.mjs base container/base
	npm --prefix container install --package-lock-only --ignore-scripts --no-audit --no-fund
	npm --prefix container/base install --package-lock-only --ignore-scripts --no-audit --no-fund

versions:
	node scripts/check-versions.mjs

check:
	node scripts/check-container.mjs check

# Preflight must precede every Compose command that could discard a container.
replace: check
	docker compose up -d --no-build --pull never --force-recreate --wait --wait-timeout 60 pi

# One-time, explicitly requested handover of an old docker-run container.
migrate: build
	node scripts/check-container.mjs migrate
	docker compose up -d --no-build --pull never --wait --wait-timeout 60 pi

attach:
	docker compose exec pi tmux attach-session -t '=shell'

# Build first, then preflight; this stays sequential even with make -j.
up: build
	$(MAKE) check
	docker compose up -d --no-build --pull never --wait --wait-timeout 60 pi
