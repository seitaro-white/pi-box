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
hardcoded `$HOME/.pi/agent` paths keep working: the entrypoint,
`herdr integration install pi`, the docs, and absolute paths inside Pi's npm
packages.

## Changes

### Dockerfile (`common` and `recommended`)

- Replace the `~/.pi/agent`, `~/.config/git` and `~/.herdr` directory creation
  with `/state` and its subfolders, all listed explicitly, owned by `node` with
  mode 0700. Docker seeds a fresh named volume from this tree, including Herdr's
  `config.toml`, so no startup creation is needed.
- `ln -s /state/pi /home/node/.pi/agent`, with `~/.pi` created as `node`.
- Repoint `CLOUDSDK_CONFIG`, `UV_*`, `PATH`, `GIT_CONFIG_GLOBAL`,
  `GH_CONFIG_DIR`, `CLAUDE_CONFIG_DIR` and the Herdr symlinks at `/state/...`.
- Drop the `~/.herdr` and `~/.config/git` directory creation.

### Container files

- `container/gitconfig`: change the credential store path to `/state/git/credentials`.
- `entrypoint.sh`, `init-git.mjs` and `init-agent.mjs` need no changes: they read
  the environment variables or `~/.pi/agent`.

### Compose and preflight

- `compose.yaml`: two volumes, `workspace` and `state`
  (`${STATE_VOLUME:-pi-box-state}`). Remove `agent`, `git` and `herdr`.
- `.env.example`: `STATE_VOLUME` replaces `AGENT_VOLUME`, `GIT_VOLUME` and `HERDR_VOLUME`.
- `scripts/check-container.mjs`: expect exactly the two volumes, have the image
  check look for `GIT_CONFIG_GLOBAL=/state/git/config`, and update the messages
  that mention "four volumes". An existing container with the old four mounts
  already fails the mount check, which correctly blocks `make replace` until
  migration.

### Migration (`scripts/migrate-state.sh`, `make migrate`)

One-off, host-side, run once after `make build`:

1. Refuse if the target state volume already exists.
2. Run the existing `check-disposable-files.sh` in the running old container,
   then stop and remove the container. The volumes are kept.
3. In a throwaway container from the new image, mount the old `agent`, `git`
   and `herdr` volumes read-only and the new `state` volume, then `cp -a`:
   - `agent/` → `pi/`, except `gcloud/` → `gcloud/` and `claude/` → `claude/`
   - `git/` → `git/`; `herdr/` → `herdr/`
   - Skip `python/`, `uv-tools/`, `bin/` and the legacy `tools/`. They contain
     absolute paths to `/home/node/.pi/agent/...` and break when moved. Print
     the `uv python install` / `uv tool install` commands needed to reinstall them.
4. Leave the old volumes untouched for rollback, and print the `docker volume rm`
   command.

Then `make up` creates the new container.

### Sandbox alignment (docs only)

- `docs/sandboxes.md` shared-storage section: the host directory gets `repos/`
  and `state/<tool>`. The `env` block in `sbxenv.local.yaml` sets
  `PI_CODING_AGENT_DIR`, `GIT_CONFIG_GLOBAL`, `GH_CONFIG_DIR`, `CLOUDSDK_CONFIG`
  and `CLAUDE_CONFIG_DIR` under `.../state/`.
- Correct the "Apple Silicon macOS" claim: sbx supports macOS 14+ on Apple
  Silicon, Windows 11 and Ubuntu 24.04+ with KVM, but only macOS has been tested here.
- No change to the mountless default, `sbxenv.yaml` or the `sandbox` stage.

### Docs and guidance

- `container/skills/pi-box/SKILL.md`: the storage table and the gcloud/gh paths.
- `README.md`, `docs/advanced.md` (gcloud migration notes), `docs/herdr.md` and
  `docs/phoenix.md` as needed.

### Tests

- Unit: `tests/check-container.test.mjs` fixtures → two volumes.
- Integration: update `tests/helpers/compose-project.mjs`, `smoke.mjs`,
  `compose-configuration.mjs`, `herdr-integration.mjs` and the fixtures
  (`check-identity.sh`, `check-persistence.mjs`, `seed-storage.mjs`,
  `check-npm-cache.sh`) to the new paths and volume names. `check-identity.sh`
  also checks that `~/.pi/agent` resolves to `/state/pi` and that Pi loads its
  settings through the symlink.
- Migration: verify manually once against copies of the real volumes, with no
  automated test. The script only reads the old volumes, which are kept, so a
  failed run is recoverable.

## Decisions

- Name: `/state`. It sits alongside `/workspace`, says what it holds, and keeps
  the volume out of `~`, which also contains image-owned files.
