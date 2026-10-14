.PHONY: build runtime check replace attach up versions

IMAGE ?= pi-box:0.2.0
CONTAINER ?= pi-box-dev
WORKSPACE_VOLUME ?= pi-box-workspace
AGENT_VOLUME ?= pi-box-agent
GIT_VOLUME ?= pi-box-git
# Recommended image only; set empty to disable Plannotator port publishing.
PLANNOTATOR_HOST_PORT ?= 19432
export IMAGE CONTAINER WORKSPACE_VOLUME AGENT_VOLUME GIT_VOLUME PLANNOTATOR_HOST_PORT

# Refresh derived runtime files before Docker copies them into the image.
build: runtime
	docker build -t "$(IMAGE)" .

runtime:
	node container/prepare-runtime.mjs recommended
	node container/prepare-runtime.mjs base container/base
	npm --prefix container install --package-lock-only --ignore-scripts --no-audit --no-fund
	npm --prefix container/base install --package-lock-only --ignore-scripts --no-audit --no-fund

versions:
	node scripts/check-versions.mjs

check:
	node scripts/dev-container.mjs check

replace:
	node scripts/dev-container.mjs replace

attach:
	node scripts/dev-container.mjs attach

# Recursive calls keep these steps sequential, even with make -j.
up:
	$(MAKE) build
	$(MAKE) replace
