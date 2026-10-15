# Agent guide — Pi Box

## Purpose and scope

Pi Box is a lightweight development container for the Pi coding-agent harness,
used locally or through SSH to the Docker host. It provides tmux, Git, ripgrep,
fd, Node.js/npm, and Python/uv. There is no SSH server inside the container.

This file is the standalone contributor guide for coding agents working on this
repository, not instructions to install into every project run inside Pi Box.
`README.md` is the user-facing setup guide; do not depend on it containing the
development rules below.

## Project map

- `Dockerfile`: shared tooling plus `base` (Pi only) and `recommended` (Pi with
  bundled extensions) targets. `recommended` is the default final target.
- `container/package.json`: authoritative runtime dependency manifest. Pi is the
  base dependency; every other direct dependency is a bundled Pi package.
- `container/prepare-runtime.mjs`: derives per-variant manifests and package
  registrations from that manifest.
- `container/entrypoint.sh`: sets a private umask, initializes Git and Pi state,
  then executes the container command (tmux by default).
- `container/init-agent.mjs`: reconciles image-owned package registrations with
  persistent operator settings.
- `container/init-git.mjs`, `container/gitconfig`: persistent Git configuration
  and HTTPS credential storage setup.
- `container/tmux.conf`: container terminal/session defaults.
- `scripts/dev-container.mjs`: host-side inspection, replacement, and attachment.
- `scripts/check-disposable-files.sh`: checks non-persistent user Git/SSH files
  before container replacement.
- `scripts/check-versions.mjs`: read-only npm version comparison.
- `tests/*.test.mjs`: focused Node built-in test suites.
- `tests/fixtures/`, `tests/helpers/`: synthetic container assertions and shared
  test infrastructure; `tests/smoke.mjs` and `tests/integration.mjs` orchestrate
  container lifecycle tests using typed JSDoc.
- Root `package.json`: development commands only, not image dependencies.

## Commands and dependencies

Run these from the repository root on the **host**, not inside the container.
Host development commands require Node.js 18+; runtime generation also needs npm
and Make. Image builds and integration tests require a running container engine.

```sh
npm test                 # Fast host tests; no install, engine, or model calls
make versions            # Compare pins with npm latest; no files changed
make runtime             # Regenerate runtime files and both lockfiles
make build               # Run make runtime, then build recommended image
```

Dependency edits belong in `container/package.json`. Use exact versions, not
`latest`, `^`, or `~`. After changing dependencies, run `make runtime` and commit
the manifest and all resulting generated changes together:

- `container/base/package.json`
- `container/defaults/settings.json`
- `container/base/defaults/settings.json`
- `container/package-lock.json`
- `container/base/package-lock.json`

Do not hand-edit those generated files. Generation may require registry access;
it retains unchanged locked dependencies rather than broadly updating them.
Direct `docker build` uses checked-in inputs and runs `npm ci` with lifecycle
scripts disabled. Keep that install policy unless explicitly changing it.

## Validation

Run `npm test` after code changes. Add or update focused regression tests for
changed behavior; use isolated temporary directories and synthetic state.

For dependency, image, startup, or persistence changes, also build both variants
and run the integration suite when a container engine is available:

```sh
make runtime
docker build --target recommended -t pi-box:0.2.0 .
docker build --target base -t pi-box:0.2.0-base .
npm run test:integration
```

The integration command runs host tests and both prebuilt-image smoke suites.
Override tags with `PI_BOX_RECOMMENDED_IMAGE` and `PI_BOX_BASE_IMAGE`. For one
image suite, use `PI_BOX_IMAGE=TAG node tests/smoke.mjs`, adding
`PI_BOX_PROFILE=base` for the base variant.

Docker is the default engine. Smoke tests support explicit Podman selection via
`PI_BOX_ENGINE=podman`, `PODMAN_BIN`, and `PODMAN_CONNECTION`; use an image built
with that engine. `DOCKER_BIN` selects a Docker executable outside PATH.

Smoke tests use uniquely named disposable resources and synthetic credentials,
not live volumes or model credentials. Storage checks are network-disabled; a
separate recommended container tests the real Plannotator UI/API with networking
and an ephemeral host-loopback port. Successful runs clean up owned resources;
failures retain them for inspection. Never use global prune to clean up tests.

Report exactly what ran and what was skipped. Host tests do not prove image
behavior; local image tests do not prove SSH forwarding, interactive terminal
behavior, model/provider access, or support on other platforms. Existing release
acceptance is Apple Silicon macOS/Docker Desktop; do not imply broader coverage
without evidence. Do not run credentialed or billable model calls by default.

## Runtime and persistence invariants

- Run as the non-root `node` user, with `/workspace` as the working directory.
  Preserve private defaults: startup umask `077`, Git storage directory `0700`,
  and Git config/credential files `0600`.
- The documented persistent mounts are `/workspace` (`pi-box-workspace`),
  `/home/node/.pi/agent` (`pi-box-agent`), and `/home/node/.config/git`
  (`pi-box-git`). Other files/installations can disappear on replacement.
- `GIT_CONFIG_GLOBAL` points to `/home/node/.config/git/config`; saved HTTPS
  credentials are stored in plaintext in that directory. SSH keys are separate
  and are not persisted by the Git volume.
- Preserve operator settings, credentials, history, unrelated installed packages,
  and resource filters for retained packages. Reconcile only image-owned package
  references. Switching to base removes bundled registrations, not user packages;
  switching back seeds their defaults. Do not reset the persistent agent volume.
- Keep initialization safe for existing state. Invalid operator settings must not
  be silently overwritten; follow the refusal behavior covered by tests.
- Never run multiple containers against the same writable volumes. Persistent
  volumes are not backups.

## Lifecycle and security boundaries

`make check` inspects the existing development container without replacing it.
`make replace` replaces it; `make up` builds and replaces it. `make attach` is
separate and does not start Pi automatically. Default container: `pi-box-dev`.
Replacement ends running sessions; rebuilding alone does not update a container.

Do not run `make up`, `make replace`, or stop/remove an existing user container
without explicit permission. Do not run lifecycle commands concurrently.
Replacement requires the three expected mounts and refuses unsafe non-persistent
Git/SSH files for the normal container user. This is not a complete backup: it
does not inspect root's home or protect arbitrary files outside mounted paths.
Do not bypass these checks or invent an automatic migration/reset path.

- Never delete/reset user volumes, run global prune, or repair ownership broadly
  without explicit permission. Limit test cleanup to resources owned by that run.
- Never read or expose real tokens, credential files, private conversations, or
  volume backups for routine development. Use synthetic test data. Do not put
  secrets in commands, clone URLs, repository files, logs, or chat output.
- Preserve documented capability dropping and no-new-privileges. Do not add host
  home or container-engine socket mounts as a convenience. The container is not
  a complete agent sandbox: same-user processes can read credentials, mounted
  data is accessible, and outbound networking is available.
- Recommended images use Plannotator remote mode on container port `19432`.
  Publish only on host loopback (`127.0.0.1:19432:19432`), not all interfaces.
  Remote browser access uses an SSH local forward to the host. The base image
  needs no published review port. Do not widen exposure or alter host SSH,
  Tailscale, firewall, or account configuration without explicit authorization.

## Change discipline

Inspect the working tree first and preserve pre-existing user edits. Keep changes
focused; follow the existing Node ES-module, built-in-test, and shell conventions
rather than adding dependencies or frameworks unnecessarily. Keep documentation
consistent with implemented behavior. Do not introduce registry publishing, CI,
license selection, or new platform-support claims as incidental changes.

In the final handoff, summarize changed paths, validation results, and remaining
limitations. Never describe unrun checks as passing.
