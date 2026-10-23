# Add Herdr to Pi-box — draft

## Goal and agreed constraints

Add a lightweight, persistent Herdr installation to the main Pi-box container so the operator can run multiple new interactive Pi sessions with agent-aware status and workspaces. The operator selected **persistent integration**, rather than a disposable installation only.

- Keep tmux as the default container process and retain its existing healthcheck and attach workflow.
- Herdr is manually launched, not a replacement for tmux at container startup.
- No sidecar, browser service, published port, cloud account, or host installation.
- No migration of current tmux sessions or agents.
- Preserve projects, credentials, Pi configuration and existing named volumes.
- Validate in disposable containers before proposing any replacement of the operator's running container.
- Planning only now; no implementation or live installation.

## Proposed choices (not previously agreed requirements)

- Include Herdr in `recommended` only; leave `base` minimal.
- Pin Herdr 0.9.5 initially, with per-architecture SHA-256 checksums. Reconfirm availability during implementation; changing the pin requires updating checksums together.
- Store config and session state under the existing agent volume, not a fourth volume.
- Install the Pi integration explicitly during operator onboarding rather than modifying global extensions at every container startup.
- Persist worktree checkouts under `/workspace/.worktrees`.

## Repository findings

`Dockerfile` has `common`, `base` and `recommended` targets. `container/entrypoint.sh` seeds Git/Pi state before execing `tmux -D`. `compose.yaml` mounts exactly three named volumes: workspace, agent and Git. `scripts/check-container.mjs` and tests enforce that contract. Runtime uses non-root `node`, drops capabilities and enables no-new-privileges.

Herdr's published ARM64 Linux binary is about 27 MB. Its v0.9.5 source uses separate `~/.config/herdr` and `~/.local/state/herdr` directories. Changing only `HERDR_CONFIG_PATH` would not persist the complete state. The integration command writes `$PI_CODING_AGENT_DIR/extensions/herdr-agent-state.ts` and supports uninstall.

## Implementation steps

### 1. Install a verified binary in the recommended image

Add a narrowly scoped build stage or download step in `Dockerfile`. Select upstream `linux-aarch64` for Docker `arm64` and `linux-x86_64` for `amd64`; reject unsupported architectures clearly. Pin release URLs and committed checksums; do not run the floating curl-to-shell installer. Download dependencies stay build-only. Install the root-owned executable at `/usr/local/bin/herdr` in `recommended` only.

Check dynamic-library requirements against Debian Bookworm before adding any runtime packages. Keep the process non-root; do not relax container restrictions or mount the Docker socket. Add a simple maintenance note for updating the release/checksum pair; extending the npm version checker is unnecessary.

### 2. Persist Herdr config, state and worktrees

Create image-owned symlinks:

- `/home/node/.config/herdr` -> `/home/node/.pi/agent/herdr/config`
- `/home/node/.local/state/herdr` -> `/home/node/.pi/agent/herdr/state`

Ensure the target directories exist privately as `node` at startup for both fresh and already-populated agent volumes. Gate Herdr-specific initialization on the executable being present so base remains unchanged. Do not change global XDG environment variables or add volumes.

Seed a small config only when missing: set `[worktrees] directory = "/workspace/.worktrees"`, verifying the exact pinned-release setting first. Keep onboarding and other defaults upstream-owned. Never overwrite an existing operator config. Do not add automatic agent supervision, remote pairing, plugins, sound configuration, or theme/keybinding customization.

Audit the pinned release's actual file/socket locations with a disposable launch. Persist durable data, not assumptions based on older docs. Verify socket paths remain short enough and stale runtime endpoints do not prevent restart. Do not blindly remove state/socket directories.

### 3. Onboard Pi explicitly

Document `docker compose exec pi-box herdr integration install pi`, then starting `docker compose exec pi-box herdr` from a separate client terminal, outside the existing tmux session if possible. Start Pi manually in a Herdr pane. No automatic launch of Pi or model calls during image startup.

Before running the integration install, detect any existing `extensions/herdr-agent-state.ts`; preserve conflicting operator content and require an explicit decision rather than overwriting it. Read the installed Pi extension documentation before implementing any Pi-specific checks. Confirm ordinary Pi sessions outside Herdr continue to work after integration installation.

Document integration refresh after a pinned Herdr upgrade, and uninstall before rolling back to an image without Herdr. Do not introduce a custom managed-extension updater.

### 4. Test without operator credentials

Extend existing image smoke tests or add one focused Herdr smoke test using unique disposable resources and the project's cleanup helpers.

- `herdr --version`, executable ownership, ARM64 launch and unchanged tmux readiness.
- Base has no Herdr; recommended does.
- Security flags remain unchanged; no published ports or extra mounts.
- Fresh and existing volume initialization is idempotent; existing Herdr config remains unchanged.
- Start Herdr headlessly, create a workspace/pane, detach/reattach where practical, stop and restart the server, and recreate the disposable container on the same test volumes. Assert a saved layout/config sentinel survives; do not claim live processes survive replacement.
- Verify Herdr and tmux coexist.
- Install/uninstall the Pi integration in disposable agent state, assert loadability using existing offline Pi checks, and verify it is harmless outside Herdr.
- Create/open/remove a worktree in a synthetic Git repository and verify checkouts stay inside `/workspace`.
- Verify native Pi resume identity using no-provider tests where possible; if that cannot establish actual conversation resume, explicitly leave it for the manual acceptance check.

Run `npm test`, existing integration/configuration checks and both image smoke profiles. Validate amd64 binary execution if an amd64 runner/emulation is available; otherwise record that limitation rather than claim it passed. Keep tests offline after the build, disable update checks in test-only config and never mount operator data.

### 5. Document and stage rollout

Update `README.md`, add `docs/herdr.md`, and document test commands in `tests/README.md`.

Cover install/profile scope, terminal-only access, default workspace cwd, multiple Pi sessions, status reporting, detach (`Ctrl+b`, then `q`), reattach, deliberate server stop, persistent locations, worktrees, integration maintenance and rollback. Describe phone access as SSH to the host then Docker exec; no new SSH/Tailscale setup in this change.

State clearly: detaching leaves jobs running while the container/host runs; container replacement kills processes; Herdr can restore layouts and resume supported conversations, not arbitrary jobs. Pi subagent children are not automatically represented as separately managed interactive sessions.

After disposable tests, report results and ask permission to replace the operator container. Use the existing `make build`/preflight/replacement workflow and an agreed interruption window. Preserve the old image for rollback; never delete named volumes. Before rolling back or downgrading, stop Herdr deliberately and preserve its state; uninstall its Pi extension when returning to an image without the executable. Never use `docker compose down -v`.

## Acceptance criteria

1. Recommended image supplies the pinned executable; base and tmux defaults are unchanged.
2. Herdr runs as `node` under current restrictions, with no new service or network exposure.
3. Both config and durable session state survive container replacement in existing volumes.
4. Pi integration is an explicit, reversible step and does not break non-Herdr Pi usage.
5. New worktree checkouts are persistent, and existing operator settings are preserved.
6. Automated tests do not use credentials or model calls; manual TUI/Pi status validation is recorded separately.
7. No operator container is replaced without approval.

## Risks and remaining verification

- Pre-1.0 upstream changes may affect runtime dependencies, socket paths, integration compatibility or restore semantics; test the pinned release rather than assume current-site docs match it.
- A common tmux prefix can be intercepted by outer tmux; recommend a separate terminal attachment instead of changing existing keybindings.
- Global extension installation persists across image changes; uninstall/refresh instructions are required.
- Config/state can contain sensitive terminal output and commands. Treat the agent volume as private and do not copy it into the repo or logs.
- Manual acceptance: two real Pi sessions report working/waiting/idle correctly, detach/reattach works, and a supported conversation resumes after a deliberate restart without unexpected submission/model activity.

## Sources

- https://herdr.dev/docs/install/
- https://herdr.dev/docs/integrations/
- https://herdr.dev/docs/session-state/
- https://herdr.dev/docs/cli-reference/
- https://github.com/herdrdev/herdr/blob/v0.9.5/src/config/io.rs
