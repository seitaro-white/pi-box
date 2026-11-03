# Plan: consolidate Compose state into one `/state` volume

## Goal

Replace the Compose image's three state volumes (`agent`, `git`, `herdr`) with
one neutral state volume at `/state`, laid out by tool, so non-Pi state no longer
lives inside Pi's config directory and the Dockerfile needs less per-tool
directory setup. Align the Docker Sandbox shared-storage variant to the same
layout so it can be trialled without learning a second layout.

## Agreed constraints

- Two Compose volumes: `/workspace` (repositories) and `/state` (all tool state).
  Repositories stay separate so state and code can be reset independently.
- State is not nested under `~/.pi/agent`; each tool gets its own subfolder.
- Compose remains the default workflow. The sandbox stays mountless by default;
  only its optional shared-storage variant adopts the layout.
- Existing users need a one-off migration from the four current volumes.
- Image-owned files in `~` (`AGENTS.md`, skills, micro settings) stay image-owned
  and are not moved into a volume.

## Layout

```
/state            node:node 0700 (volume root)
  pi/             Pi agent dir; ~/.pi/agent -> /state/pi
  git/            GIT_CONFIG_GLOBAL=/state/git/config, credentials, GH_CONFIG_DIR=/state/git/gh
  gcloud/         CLOUDSDK_CONFIG
  claude/         CLAUDE_CONFIG_DIR
  uv/python/      UV_PYTHON_INSTALL_DIR
  uv/tools/       UV_TOOL_DIR
  uv/bin/         UV_PYTHON_BIN_DIR, UV_TOOL_BIN_DIR, on PATH
  herdr/config/   ~/.config/herdr -> /state/herdr/config (config.toml seeded)
  herdr/state/    ~/.local/state/herdr -> /state/herdr/state
```

`~/.pi/agent` becomes a symlink rather than relying on `PI_CODING_AGENT_DIR`, so
hardcoded `$HOME/.pi/agent` paths (entrypoint, `herdr integration install pi`,
docs, Pi npm package paths) keep working.

## Changes

### Dockerfile (`common` and `recommended`)

- Replace the `~/.pi/agent`, `~/.config/git` and `~/.herdr` directory creation
  with `/state` and its subfolders, owned by `node`, mode 0700. A fresh named
  volume is seeded from this tree, including Herdr's `config.toml`.
- `ln -s /state/pi /home/node/.pi/agent` (create `~/.pi` as `node`).
- Repoint `CLOUDSDK_CONFIG`, `UV_*`, `PATH`, `GIT_CONFIG_GLOBAL`,
  `GH_CONFIG_DIR`, `CLAUDE_CONFIG_DIR` and the Herdr symlinks at `/state/...`.
- Drop `~/.herdr` and `~/.config/git` creation.

### Container files

- `container/gitconfig`: credential store path → `/state/git/credentials`.
- `container/entrypoint.sh`: create any missing `/state/<tool>` subfolders with
  `install -d -m 0700` so existing (migrated) volumes gain new subfolders.
- `init-git.mjs`, `init-agent.mjs`: no change (both read env/`~/.pi/agent`).

### Compose and preflight

- `compose.yaml`: two volumes, `workspace` and `state`
  (`${STATE_VOLUME:-pi-box-state}`); remove `agent`, `git`, `herdr`.
- `.env.example`: `STATE_VOLUME` replaces `AGENT_VOLUME`, `GIT_VOLUME`, `HERDR_VOLUME`.
- `scripts/check-container.mjs`: expect exactly the two volumes; image check
  looks for `GIT_CONFIG_GLOBAL=/state/git/config`; update messages
  ("two volumes"). An existing container with the old four mounts already fails
  the mount check, which correctly blocks `make replace` until migration.

### Migration (`scripts/migrate-state.sh`, `make migrate`)

One-off, host-side, run once after `make build`:

1. Run the existing disposable-files check in the running old container, then
   stop and remove the container (volumes are kept).
2. In a throwaway container from the new image, mount old `agent`, `git`,
   `herdr` volumes read-only and the new `state` volume, then `cp -a`:
   - `agent/` → `pi/`, except `gcloud/` → `gcloud/` and `claude/` → `claude/`
   - `git/` → `git/`; `herdr/` → `herdr/`
   - Skip `python/`, `uv-tools/`, `bin/` and legacy `tools/`: they contain
     absolute paths to `/home/node/.pi/agent/...` and break when moved. Print
     the `uv python install` / `uv tool install` commands to reinstall them.
3. Refuse to run if the state volume is non-empty.
4. Leave old volumes untouched for rollback; print the `docker volume rm` command.

Then `make up` creates the new container.

### Sandbox alignment (docs only)

- `docs/sandboxes.md` shared-storage section: host directory gets `repos/` and
  `state/<tool>`; `sbxenv.local.yaml` env sets `PI_CODING_AGENT_DIR`,
  `GIT_CONFIG_GLOBAL`, `GH_CONFIG_DIR`, `CLOUDSDK_CONFIG`, `CLAUDE_CONFIG_DIR`
  under `.../state/`.
- Correct the "Apple Silicon macOS" claim: sbx supports macOS 14+ Apple Silicon,
  Windows 11 and Ubuntu 24.04+ with KVM; only macOS has been tested here.
- No change to the mountless default, `sbxenv.yaml` or the `sandbox` stage.

### Docs and guidance

- `container/skills/pi-box/SKILL.md` storage table and gcloud/gh paths.
- `README.md`, `docs/advanced.md` (gcloud migration notes), `docs/herdr.md`,
  `docs/phoenix.md` as needed.

### Tests

- Unit: `tests/check-container.test.mjs` fixtures → two volumes.
- Integration: `tests/helpers/compose-project.mjs`, `smoke.mjs`,
  `compose-configuration.mjs`, `herdr-integration.mjs`, fixtures
  (`check-identity.sh`, `check-persistence.mjs`, `seed-storage.mjs`,
  `check-npm-cache.sh`) → new paths and volume names.
- Add a migration test: seed old-style volumes, run the migration, check files
  land in the new layout with mode 0700 and that a second run refuses.

## Assumptions and open questions

- Pi resolves its agent dir through the `~/.pi/agent` symlink without issue
  (realpath differences in package paths). Verify in the smoke test.
- `/state` as the name; alternatives `/data`, `~/.local/share/pi-box`.
- Whether to keep the old volumes after migration or delete them automatically
  (draft: keep, print command).
