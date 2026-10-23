# Add Herdr to Pi-box

## User goal and agreed constraints

Provide a lightweight, persistent Herdr installation inside the main Pi-box container for managing new interactive Pi sessions. The operator explicitly chose **persistent integration**, not a disposable-only installation.

- Keep tmux, its default startup, healthcheck and existing attach workflow.
- Launch Herdr manually alongside tmux; do not migrate existing sessions.
- No sidecar, browser dashboard, exposed port, cloud account or Mac installation.
- Preserve projects, credentials, existing Pi settings and named volumes.
- Test with disposable resources before requesting permission to replace the live container.
- This document is a plan only. Do not install, build, replace containers or alter runtime configuration during planning.

## Design decisions proposed by this plan

These choices were not individually specified by the operator:

1. Include Herdr in `recommended` only, leaving `base` minimal.
2. Pin the upstream binary and its architecture-specific checksum; initial candidate: v0.9.5.
3. Reuse the agent volume for config/state and the workspace volume for worktrees. No new volume.
4. Make the Pi extension an explicit one-time onboarding command, not an automatic startup mutation.
5. Keep normal upstream onboarding/UI behaviour; do not introduce an orchestration framework or custom Herdr launcher.

## Current project and upstream findings

- `Dockerfile` has `common`, `base`, and `recommended` targets. `container/entrypoint.sh` initializes persistent Git/Pi state and execs the supplied command, normally `tmux -D`.
- `compose.yaml` mounts three named volumes: `/workspace`, `/home/node/.pi/agent`, and `/home/node/.config/git`. Preflight and configuration tests enforce that exact contract.
- The container runs as `node` with all Linux capabilities dropped and no-new-privileges. Keep those restrictions.
- Herdr is one executable, approximately 27 MB for ARM64 Linux.
- The v0.9.5 source distinguishes `~/.config/herdr` from `~/.local/state/herdr`; persisting only the config file is insufficient.
- `herdr integration install pi` writes `$PI_CODING_AGENT_DIR/extensions/herdr-agent-state.ts`; uninstall removes that extension.

## Implementation checklist

### 1. Add a verified Herdr binary to the recommended image

- Add a small download stage in `Dockerfile`, copying only the executable into `recommended` at `/usr/local/bin/herdr`. Keep download tooling out of the final image.
- Map Docker `arm64` to upstream `linux-aarch64` and `amd64` to `linux-x86_64`; reject unsupported architectures.
- Pin release URL/version and committed checksums. Never execute the floating installer or fetch a latest-version manifest at build time.
- Initial v0.9.5 checksum candidates, to verify against upstream release metadata during implementation:

  | Architecture | SHA-256 |
  |---|---|
  | ARM64 | `17d7536f2da50859523680ef279dffcac8e4a235f4e46fe8da6c2ec44141897c` |
  | AMD64 | `14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d` |

- Make the executable root-owned and executable by `node`. Test library compatibility with Bookworm; add runtime dependencies only if actually required.
- Document upgrades through image pin/checksum changes, not `herdr update` in the running container. Do not extend the npm version-checking machinery for this binary.

### 2. Persist config/state without changing Compose storage

Use fixed image-owned symlinks in `recommended`:

| Standard path | Persistent target |
|---|---|
| `/home/node/.config/herdr` | `/home/node/.pi/agent/herdr/config` |
| `/home/node/.local/state/herdr` | `/home/node/.pi/agent/herdr/state` |

- Add only the small initialization needed to create private target directories as `node`, including when the agent volume predates Herdr. Run this only when Herdr is installed; keep base behaviour unchanged.
- Seed a minimal config **only if absent**, setting `[worktrees] directory = "/workspace/.worktrees"`; verify this key against the pinned binary first. Leave other settings/onboarding at upstream defaults.
- Preserve existing operator config. Do not set global `XDG_CONFIG_HOME`/`XDG_STATE_HOME`, change the three-volume contract or introduce a wrapper just to redirect paths.
- Confirm actual durable files and runtime endpoints with the pinned release in a disposable container. Test a stop/restart and container recreation to catch stale-endpoint or Unix socket-length failures. Do not delete state directories to make tests pass.
- Leave Herdr stopped until the operator launches it. The entrypoint must not start Herdr, Pi or any model request.

Expected touched files: `Dockerfile`, `container/entrypoint.sh`, and a small Herdr defaults file if needed. `compose.yaml` and `scripts/check-container.mjs` should not need changes.

### 3. Add an explicit Pi onboarding path

Document this sequence from a separate terminal, not from inside the existing tmux session:

```bash
# First check that no conflicting Herdr Pi extension already exists.
docker compose exec pi-box herdr integration install pi

docker compose exec pi-box herdr
# Start pi inside a Herdr terminal pane.
```

- Before using the installer, inspect any existing `extensions/herdr-agent-state.ts`; do not overwrite unknown operator content. No automatic extension reconciliation at every startup.
- Verify the bundled extension against the installed Pi version, reading Pi's extension docs before writing any Pi-specific implementation/tests.
- Confirm extension installation is harmless for Pi sessions outside Herdr. Do not assume this solely from upstream advertising.
- Explain extension refresh after an image upgrade, and uninstall before rollback to an image without Herdr.
- Existing Pi sessions need not be moved or restarted. Agent-aware reporting is tested with new sessions.

### 4. Add focused regression coverage and disposable smoke checks

Reuse the existing test style and disposable-resource helpers rather than creating a new test framework.

**Automated checks, no credentials or model calls:**

- Recommended contains the pinned root-owned executable; base does not. Existing tmux readiness and privilege restrictions still pass.
- Fresh and populated agent volumes initialize correctly, repeated startup is idempotent, and an existing operator Herdr config is unchanged.
- Start a headless Herdr server, create one synthetic workspace/pane, save it through a clean server stop, then recreate the disposable container using the same test volumes. Launch Herdr manually and assert config/layout preservation and no endpoint collision. Do not assert that live processes survive recreation.
- Keep tmux running while exercising Herdr.
- Install/uninstall the Pi integration in disposable state. Use the existing offline extension-loading checks, including loading outside Herdr, rather than building a simulated provider or elaborate hook emulator.
- Create/remove one worktree in a synthetic Git repo; confirm its checkout is under `/workspace`. This checks the persistence setting, not every upstream worktree feature.
- Keep tests offline after image build and disable upstream update checks in test-only config. Clean up only resources owned by that test run.

Run `npm test`, the existing Compose configuration checks, and smoke tests for both image profiles. Run the focused Herdr recreation test. Validate AMD64 execution on an available runner/emulator; record it as unverified if unavailable. No CI/platform expansion solely for this change.

**Manual acceptance, after automated checks:**

- Two new real Pi sessions show working/idle and a supported waiting state correctly.
- Mouse/keyboard navigation, detach (`Ctrl+b`, then `q`) and reattach work in the operator's terminal.
- A supported Pi conversation resumes after a deliberate Herdr server restart. Explain that launching/restoring an agent may itself perform normal agent startup network activity; do not promise a network-free manual test.
- If session resume cannot be verified, report that limitation rather than claim it works.

### 5. Document usage and request a controlled rollout

Update `README.md`, add `docs/herdr.md`, and add test instructions to `tests/README.md`.

Document:

- Recommended-only availability, terminal UI, explicit integration installation, startup cwd and multiple new Pi sessions.
- Detach/reattach versus deliberately stopping the Herdr server.
- Config/state locations and persistent worktrees. Respect existing operator config if it chooses a different worktree location; explain that locations outside mounted storage are disposable.
- Container recreation kills running processes. Herdr can restore layouts/resume supported conversations, not arbitrary jobs. Reattach does not keep a sleeping host computing.
- Phone access: existing secure SSH access to the host, then Docker exec. No SSH/Tailscale configuration work or new port in this feature.
- Avoid nesting tmux inside Herdr panes. Using a separate terminal also avoids the outer tmux consuming Herdr's default prefix.
- This is not automatic supervision or a dashboard for every `pi-subagents` child.
- Private terminal state may include sensitive output. Keep it out of Git and shared logs.
- Upstream manifest/update checks are separate from the pinned executable; explain their defaults and how to disable them if desired. Do not silently broaden network restrictions or invent a custom updater.

After reporting disposable-test results, ask permission and agree an interruption window before replacing the operator container. Preserve/tag the current image for rollback **before** building over its tag. Use the project's existing build/preflight/replacement workflow; stop jobs deliberately first. Preserve all named volumes, and never use `docker compose down -v`.

Rollback: stop Herdr deliberately, preserve its state, uninstall its Pi extension while the executable is still available if reverting to an image without Herdr, then restore the previous image through the same preflight workflow. Do not delete the persistent Herdr directory or worktrees automatically. The previously installed extension is operator-volume state, so merely changing image tags will not remove it.

## Acceptance criteria

1. Recommended supplies the verified binary; base, tmux defaults and the three-volume contract are unchanged.
2. Herdr operates as `node` under current security restrictions, without a new service or published port.
3. Config and saved layout/state survive disposable container recreation; Herdr still requires manual launch.
4. Pi integration is explicit/reversible, loads on the pinned Pi version and does not break non-Herdr sessions.
5. Fresh default worktrees live in persistent workspace storage; existing settings are not overwritten.
6. Automated checks use no operator credentials or model requests. Manual UI/Pi results and platform limitations are reported distinctly.
7. No live container replacement occurs without approval.

## Deferred work

Agent Deck, browser/mobile web access, remote machine pairing, conductors, Herdr skills/plugins, automatic per-task worktrees, automatic integration updates, dedicated state volumes, replacing tmux, and Docker Sandboxes support/validation. The inherited sandbox image must not be accidentally broken, but sandbox deployment is not an acceptance target for this Compose integration.

## Review assessment

The draft meets the persistent-integration goal and preserves the existing tmux workflow. It is appropriately small architecturally, but its validation section mixed core integration tests with broader upstream UI/resume testing. The revised plan retains verified downloads, complete state persistence and non-destructive rollout, while moving terminal interaction and real conversation resume to manual acceptance. It also makes rollback ordering explicit so rebuilding does not lose the old image tag. No new service, storage abstraction, updater or orchestration layer is justified.

## Review changelog

| Decision | Status | Reason |
|---|---|---|
| Move interactive detach/reattach and actual Pi conversation resume to manual acceptance | Applied | Avoid a new PTY/provider test harness; retain focused offline integration coverage. |
| Reduce worktree automation to one persistent-path smoke test | Applied | Verify our setting rather than retest upstream's whole worktree implementation. |
| Preserve the old image tag before building | Applied | Building over the existing tag otherwise weakens rollback instructions. |
| Explicitly exclude Docker Sandboxes rollout and new CI architecture infrastructure | Applied | The agreed use case is the running Compose Pi-box, not a second deployment project. |
| Use one-time extension installation instead of startup synchronization | Not applied: automation alternative rejected | Preserve operator-owned extension state and avoid unnecessary ownership/update machinery. |
| Add a fourth dedicated Herdr volume | Not applied | Existing agent storage suffices and avoids widening Compose/preflight contracts. |

## References

- https://herdr.dev/docs/install/
- https://herdr.dev/docs/integrations/
- https://herdr.dev/docs/session-state/
- https://herdr.dev/docs/cli-reference/
- https://herdr.dev/docs/agents/
- https://github.com/herdrdev/herdr/blob/v0.9.5/src/config/io.rs
