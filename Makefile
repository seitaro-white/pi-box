.PHONY: build check replace attach up versions

IMAGE ?= pi-box:0.2.0
CONTAINER ?= pi-box-dev
WORKSPACE_VOLUME ?= pi-box-workspace
AGENT_VOLUME ?= pi-box-agent
GIT_VOLUME ?= pi-box-git
export IMAGE CONTAINER WORKSPACE_VOLUME AGENT_VOLUME GIT_VOLUME

build:
	docker build -t "$(IMAGE)" .

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
