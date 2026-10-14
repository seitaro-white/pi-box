.PHONY: build check replace attach up versions

IMAGE ?= pi-box:0.2.0
CONTAINER ?= pi-box-dev
WORKSPACE_VOLUME ?= pi-box-workspace
AGENT_VOLUME ?= pi-box-agent
export IMAGE CONTAINER WORKSPACE_VOLUME AGENT_VOLUME

build:
	docker build -t "$(IMAGE)" .

versions:
	node scripts/check-versions.mjs

check:
	bash scripts/dev-container.sh check

replace:
	bash scripts/dev-container.sh replace

attach:
	bash scripts/dev-container.sh attach

# Recursive calls keep these steps sequential, even with make -j.
up:
	$(MAKE) build
	$(MAKE) replace
