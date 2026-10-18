.PHONY: build runtime check replace migrate attach up versions db-init db-stop

IMAGE ?= pi-box:0.2.0
TARGET ?= recommended
CONTAINER ?= pi-box-dev
WORKSPACE_VOLUME ?= pi-box-workspace
AGENT_VOLUME ?= pi-box-agent
GIT_VOLUME ?= pi-box-git
export IMAGE TARGET CONTAINER WORKSPACE_VOLUME AGENT_VOLUME GIT_VOLUME

# One optional overlay, not a second lifecycle implementation.
DATABASE ?= 0
DATABASE_ENV_FILE ?= .env.postgres
ifeq ($(DATABASE),1)
COMPOSE_FILE ?= compose.yaml:compose.postgres.yaml
COMPOSE_ENV_FILES ?= $(DATABASE_ENV_FILE)
export COMPOSE_ENV_FILES
endif
COMPOSE_FILE ?= compose.yaml
export DATABASE DATABASE_ENV_FILE COMPOSE_FILE

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

db-init:
	node scripts/init-database.mjs

db-stop:
	@test "$(DATABASE)" = 1 || { echo 'Use make db-stop DATABASE=1' >&2; exit 1; }
	docker compose stop db

check:
	node scripts/check-container.mjs check

# Preflight must precede every Compose command that could discard a container.
replace: check
	docker compose up -d --no-build --pull never --no-deps --force-recreate --wait --wait-timeout 60 pi

# One-time, explicitly requested handover of an old docker-run container.
migrate: build
	node scripts/check-container.mjs migrate
	docker compose up -d --no-build --pull missing --wait --wait-timeout 60 pi

attach:
	docker compose exec pi tmux attach-session -t '=shell'

# Build first, then preflight; this stays sequential even with make -j.
up: build
	$(MAKE) check
	docker compose up -d --no-build --pull missing --wait --wait-timeout 60 pi
