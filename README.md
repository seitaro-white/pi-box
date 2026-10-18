# Pi Box

Lightweight development container built around the [Pi](https://pi.dev) agent harness. Run locally or SSH into the machine hosting it.

Comes installed with:
- [Pi](https://pi.dev), with pi-subagents, pi-web-access, pi-usage and pi-lsp by default (or Pi only)
- Ruff and Biome for Python/JavaScript linting and formatting (recommended image only)
- [tmux](https://github.com/tmux/tmux/wiki) for persistent, reconnectable sessions
- micro and nano terminal text editors
- nnn terminal file manager and bat syntax-highlighted file viewer
- Git, ripgrep (`rg`) and fd
- Python and uv
- JavaScript tooling: Node.js and npm
- PostgreSQL 15 client (`psql`); the server is an optional separate container

This is my personal remote development setup for coding, which I thought I'd share with the world and develop publicly. I primarily SSH into it, but it works as a local development environment too if you're into that.

## Quickstart — install and run locally

Install Docker with **Docker Compose v2.24+**, Node.js 18+ (including npm), and
Make. Docker Desktop includes Compose. Run commands from your **host terminal**
in this repository, with Docker running.

### Everyday commands

```bash
make up       # Build, preflight, then let Compose start/update Pi Box
make attach   # Attach to the ready tmux shell
```

Inside tmux, run `pi` from `/workspace` or your project directory.
**Detach with Ctrl+B, then D.** Use `make attach` to reconnect; if Pi is already
running, don't start a second instance. For VS Code, use **Dev Containers:
Attach to Running Container…**.

By default, Compose starts only `pi`, using [`compose.yaml`](compose.yaml).
PostgreSQL is opt-in through your local `.env` (see below). Neither setup
publishes database ports. `make up` starts all selected services, waits for
readiness and does not launch Pi automatically. An unchanged `up` keeps existing sessions; a changed image or
configuration can recreate the container and end them.

Other useful commands:

```bash
make build                  # Build only; don't touch the container
make check                  # Read-only preflight; requires the built image
make replace                # Preflight, then force recreation using the built image
docker compose logs pi      # View logs
docker compose exec pi bash # Open a separate shell (not tmux)
```

The Makefile is a thin wrapper: Compose owns builds, networking, startup,
recreation and health waiting. `scripts/check-container.mjs` adds only the
read-only storage and replacement checks. **Use Make for startup/replacement:**
direct `docker compose up` bypasses those checks. Don't run lifecycle commands
concurrently.

### Storage and replacement safeguards

Three explicitly named volumes keep the same names and mount paths as before:

| Volume | Container path | Contents |
| --- | --- | --- |
| `pi-box-workspace` | `/workspace` | Projects |
| `pi-box-agent` | `/home/node/.pi/agent` | Pi settings, login and conversations |
| `pi-box-git` | `/home/node/.config/git` | Git settings and HTTPS credentials |

Compose creates missing volumes and reuses existing ones. The image runs as
`node`, drops all Linux capabilities and enables `no-new-privileges`. Volumes
with incompatible ownership need manual repair.

Before any potentially destructive `up` or `replace`, preflight verifies the
three writable named mounts, refuses non-persistent Git files/SSH keys under
`/home/node`, and rejects volumes used by other running containers. This is
**not a complete backup or filesystem scan**: other files outside the mounts
can be lost, and root's home is not inspected. Extra/bind mounts, differently
named existing services and foreign Compose projects require manual handling.

A stopped existing container must be started before its files can be inspected:
use `docker compose start --wait pi`. This does not replace it.

**Never use `docker compose down -v` on storage you want to keep.** It deletes
Compose-managed volumes. Ordinary `down` retains volumes but ends sessions.

### Choose your services once — local `.env`

Compose reads `.env` automatically for both Make and direct Compose commands.
Without this file, the default is Pi Box only. To configure a local setup:

```bash
cp -n .env.example .env  # Don't overwrite an existing private configuration
```

Edit `COMPOSE_FILE` in `.env` to select the files that make up your environment:

```dotenv
# Pi Box only:
COMPOSE_FILE=compose.yaml
```

Or, for Pi Box with PostgreSQL:

```dotenv
COMPOSE_FILE=compose.yaml:compose.postgres.yaml
```

Then use plain `make up` and `make attach`—no service-enable flags to remember.
The PostgreSQL selection also needs a password in `.env`, as described below.
Future optional capabilities can have their own Compose files appended to this
list instead of adding Make conditionals. There is no Langfuse service yet.

`.env` is private, Git-ignored and excluded from image builds. It can hold both
configuration and credentials. Shell environment variables or explicit command
line overrides take precedence over this file.

### Image variants and overrides

`recommended` is the default: Pi, bundled extensions, Ruff and Biome. For Pi
without bundled extensions or those linters:

```bash
make up TARGET=base IMAGE=pi-box:0.2.0-base
```

Both variants retain the shared development tools. Exact npm versions live in
[`container/package.json`](container/package.json); Ruff is pinned in the
Dockerfile. Builds stay local; nothing is published to a registry.

You can override `IMAGE`, `TARGET`, `CONTAINER`, `WORKSPACE_VOLUME`,
`AGENT_VOLUME`, `GIT_VOLUME` and `COMPOSE_PROJECT_NAME`. For example:

```bash
make up IMAGE=pi-box:custom WORKSPACE_VOLUME=my-workspace AGENT_VOLUME=my-agent GIT_VOLUME=my-git
```

For a persistent choice, put these settings in `.env` rather than repeating
command-line overrides. For example, use `TARGET=base` and
`IMAGE=pi-box:0.2.0-base` there for the base image. The same settings then apply
to `up`, `attach`, checks and direct Compose commands. Use a distinct
project/container and three distinct volumes for an independent second instance;
don't share writable volumes between instances.

## Optional PostgreSQL — development only

Set these values manually in your private `.env` (choose your own password):

```dotenv
COMPOSE_FILE=compose.yaml:compose.postgres.yaml
POSTGRES_PASSWORD=<your-strong-private-password>
```

For an existing database, keep its current `POSTGRES_PASSWORD` unchanged.
Then run from the host repository:

```bash
chmod 600 .env
make up                      # Start the services selected in .env
make attach
```

A changed image or configuration may replace Pi Box and end running sessions;
finish active work first.

[`compose.postgres.yaml`](compose.postgres.yaml) adds PostgreSQL and Pi's
connection settings to the base configuration. Both Pi image variants include
Debian's PostgreSQL 15 client; the server image is a digest-pinned,
multi-architecture PostgreSQL 15 image. There is no extra package repository.
The server image is pulled automatically if missing.

Inside Pi Box, Pi or your application can use:

```bash
psql -c 'SELECT current_user, current_database();'
```

The connection is **`db:5432`, database `appdb`, login `postgres`**. Standard libpq
variables (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`) are set in
Pi's environment; libraries that use a connection URL must be configured by
your application without committing its password. `localhost` inside Pi is
not the database container. No host/SSH port forwarding is needed.

Pi uses the **PostgreSQL administrator account directly**, with one password.
It can manage all databases and users on this server, not just tables in `appdb`.
This is a convenience for trusted local development, not a restricted database
sandbox or a production access model.

`appdb` is simply the database name, not a second login or permission layer.
The official image creates it on first startup with empty storage. There are no
custom role-provisioning scripts, demo tables or sample data. Existing databases,
users and their data are left intact when reusing a volume.

### Credentials and persistence

Set `POSTGRES_PASSWORD` manually in `.env` and keep the file Git-ignored and
private (`chmod 600 .env`). Editing its value does
**not** rotate the password in an initialized database, so reuse the existing
administrator password with existing storage. The same password is passed to
Pi as `PGPASSWORD` and to PostgreSQL as `POSTGRES_PASSWORD`. Docker administrators
and `docker compose config` can reveal these environment values.

PostgreSQL stores data in its own project-scoped volume, normally
**`pi-box_postgres`**, mounted at `/var/lib/postgresql/data`. It survives container
recreation. PostgreSQL initializes storage only when this volume is empty.
`make replace` replaces **Pi only**, leaving the database container alone;
`make up` starts all services selected in `.env`. Volumes are not backups. Never use
`down -v` on data you need, share writable database storage between containers,
or change the server's major version without a PostgreSQL data migration.

To stop the database without deleting its data:

```bash
docker compose stop db
```

Run that while the PostgreSQL overlay is still selected. To return Pi to its
normal environment, then change `.env` to `COMPOSE_FILE=compose.yaml` and run
`make up`. Removing a file from the selection does not automatically stop a
previously running service or delete its data. The password may remain in
`.env`; Pi-only mode does not pass it into Pi.

Direct Compose commands use the same local selection automatically:

```bash
docker compose logs db
```

For an independent instance, use a different Compose project name and Pi
container/volume settings, with its own private `.env` and password.

This is a minimal local development service—not a production database setup or
an automatic backup, upgrade or password-management system.

## Git setup and private repositories

Inside the container, configure your identity once:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git clone https://github.com/OWNER/REPO.git
```

For a private repository, enter your GitHub username and a **scoped personal
access token** at the password prompt, not your account password. Create a
[fine-grained PAT](https://github.com/settings/personal-access-tokens/new) for
only the repositories you need: Contents read-only for cloning/pulling, or
read/write for pushing, with an expiration. Organizations may require approval.
Never put a token in a command, clone URL, repository file, or chat transcript.
No GitHub CLI is required.

`GIT_CONFIG_GLOBAL` points to `/home/node/.config/git/config`. The image supplies
a credential-store helper in `/etc/gitconfig` using
`/home/node/.config/git/credentials`. Startup only prepares private storage; it
does not rewrite your settings or require valid Git config to start tmux.
A successful authenticated HTTPS operation saves the credential there; settings
and saved credentials survive restart and replacement when the same Git volume
is reused. GitHub credentials are matched by repository path, so a different
repository URL may prompt again. Expired or revoked PATs still need replacement.

Personal settings override image defaults using Git's normal config layers.
To replace the default helper, first reset the inherited helper list with
`git config --global credential.helper ""`, then add your chosen helper with
`git config --global --add credential.helper HELPER`.

**Tokens are stored as plaintext.** The directory is restricted to its owner
(mode 700), and config/credential files use mode 600. Pi and other processes
running as the same container user—and anyone with host Docker access—can still
read them. Do not publish or commit volume backups. SSH keys and SSH Git
authentication are separate and are not persisted by this volume.

## Optional — remote access with Tailscale and SSH

Run Pi Box on the host first using the steps above. The connection is:

```text
Your laptop → SSH to the host → container → tmux
```

### 1. Connect both devices to Tailscale

[Install Tailscale](https://tailscale.com/download) on the host and your connecting laptop, and join the same tailnet. Note the host's Tailscale IP or MagicDNS name. Make sure your tailnet access rules allow the intended laptop/user to reach the host's SSH port (normally TCP 22).

### 2. Enable ordinary SSH on the host

On macOS, go to **System Settings → General → Sharing → Remote Login**. Under **Allow access for**, choose **Only these users** and select the intended account. Enabling Remote Login can also permit connections from your LAN; Tailscale doesn't automatically restrict the SSH server to tailnet traffic.

On Linux, enable your distribution's OpenSSH server. Use the host's normal SSH authentication, preferably keys, and verify its host-key fingerprint when connecting for the first time. Your SSH account must also be able to run Docker on that host; Docker access is privileged, so don't grant it to untrusted users.

This guide uses **ordinary SSH over Tailscale**, not the separate **Tailscale SSH** feature. No SSH server inside the container or public router port forwarding is needed. See [Tailscale's connection guide](https://tailscale.com/kb/1452/connect-to-devices) for networking details.

### 3. Connect and attach

From your laptop:

```bash
ssh YOUR_HOST_USERNAME@YOUR_HOST_TAILSCALE_ADDRESS
```

Then, in the host's SSH shell, change into this repository and attach:

```bash
cd /path/to/pi-box
make attach
```

Start `pi` in the attached shell if it is not already running. No SSH port
forwarding is required.

Detach with **Ctrl+B, then D**, then `exit` to close SSH. Pi continues on the
host.

The host must stay awake and online, with Tailscale, Docker and the container running. Stopping/restarting the container or host ends running work; saved conversations can be resumed manually. Windows-host SSH instructions and VM/cloud deployment are not covered yet.

## Safety and persistence

The container runs as a non-root user, drops Linux capabilities and mounts neither your host home directory nor a container-engine socket. These reduce privileges but are **not a complete agent sandbox**. Pi can access container credentials, mounted data and outbound networking. Extensions use upstream defaults; review their capabilities and resource limits for your workload.

Only `/workspace`, `/home/node/.pi/agent`, and `/home/node/.config/git` persist through container replacement with the documented mounts. Files and installations elsewhere may disappear. Don't run multiple containers against the same writable volumes. Existing Pi/extension settings are retained when rebuilding; image changes don't reset operator preferences. Startup registers the current image's bundled packages by default and removes obsolete image-owned references when switching variants. It preserves unrelated user-installed packages, credentials, history and resource filters for retained packages. The base image does not disable packages you installed yourself in the persistent volume. Switching to base removes the bundled packages' settings entries, including their resource filters; switching back seeds default registrations.

**Persistent volumes are not backups.** You are responsible for recovery. Volume exports can contain credentials and private conversations; never commit or publicly upload them. Deleting/resetting the container engine's VM can destroy its volumes.

## Code quality tools (recommended image)

The recommended image bundles [`@narumitw/pi-lsp`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-lsp), Ruff (installed with uv) and Biome (installed with npm). They are image-owned, available on `PATH`, and remain available when an existing agent volume is mounted. The base image includes none of these three additions.

Inside Pi, `/lsp` shows server availability. The agent can request `lsp_diagnostics` for Python or JavaScript and `lsp_fix` for supported source actions. Ruff handles Python lint diagnostics; Biome handles JavaScript/TypeScript diagnostics. No Python type checker is bundled. Other default server routes may be listed as unavailable; they are not automatically installed.

This extension does **not** automatically format edits or run checks after each write. Ask the agent to format and lint changed files before finishing, or add that instruction to the project's `AGENTS.md`. The CLI commands are also available directly:

```bash
ruff format path/to/file.py
ruff check path/to/file.py
biome check --write path/to/file.mjs  # Formatting and safe lint fixes
biome check path/to/file.mjs
```

No LSP policy config is seeded: upstream defaults work with the installed tools, and existing operator settings are preserved. To select servers explicitly, configure `.pi/pi-lsp.json` in a trusted project or `~/.pi/agent/pi-lsp.json`; a custom server map replaces the defaults. Formatting/lint rules belong in each project's Ruff/Biome configuration. LSP feedback does not replace the project's authoritative checks and tests.

## Updating Pi and extensions

Run `make versions` to compare the pinned Pi, extension, npm tool and override versions with npm's `latest` dist-tags (requires Node.js, npm and registry access). This is read-only; lookup failures produce a nonzero exit status. A different version is not necessarily newer or compatible.

Edit the exact npm versions in **`container/package.json`**. Pi is the base dependency; other direct dependencies are bundled Pi packages unless listed in `piBox.npmTools`. Those CLI tools are installed only in recommended and are not registered as Pi packages. To add or remove an extension, add or remove its dependency there. Keep exact versions, not `latest`, `^` or `~` ranges. Update Ruff's pinned `RUFF_VERSION` in the recommended Dockerfile stage separately.

Regenerate the derived base manifest, package registrations and both lockfiles:

```bash
node container/prepare-runtime.mjs recommended
node container/prepare-runtime.mjs base container/base
npm --prefix container install --package-lock-only --ignore-scripts --no-audit --no-fund
npm --prefix container/base install --package-lock-only --ignore-scripts --no-audit --no-fund
```

Do not hand-edit `container/base/package.json` or either `defaults/settings.json`; they are derived from the authoritative manifest. Commit the manifest, generated files and both lockfiles together. Builds derive their manifests/registrations again and use `npm ci` with lifecycle scripts disabled; a mismatched lockfile fails the build. Rebuild both variants and run the tests below before using a new dependency set. This does not update or replace any existing container automatically.

## Development tests

Run focused host tests with Node's built-in runner—no dependency installation, container engine or model calls needed. They cover manifest consistency, fresh defaults, operator-state preservation, variant switching, legacy settings reconciliation and safe refusal of broken settings:

```bash
npm test
```

After building both variants, explicitly opt into the full integration suite:

```bash
npm run test:integration
```

This runs host tests, both image smoke suites, Compose acceptance and the focused
PostgreSQL integration test. It uses prebuilt Pi images, pulls the pinned database
image if needed, and uses disposable storage/credentials—not your running setup.
For different image tags:

```bash
PI_BOX_BASE_IMAGE=pi-box:my-base \
PI_BOX_RECOMMENDED_IMAGE=pi-box:my-recommended \
npm run test:integration
```

Test organization:
- `tests/*.test.mjs`: named `node:test` suites; each stateful test has its own temporary directory and automatic cleanup.
- `tests/fixtures/`: container assertions and synthetic state, kept separate from host orchestration.
- `tests/helpers/`: shared setup, cleanup and engine selection.
- `tests/smoke.mjs`: image acceptance, runnable separately with `node tests/smoke.mjs` or `PI_BOX_PROFILE=base node tests/smoke.mjs`.
- `tests/compose.mjs`: real Make/Compose startup, idempotency, forced replacement, refusal guards, and persistent storage across full teardown/recreation. Run separately with `PI_BOX_RECOMMENDED_IMAGE=pi-box:0.2.0 node tests/compose.mjs`.
- `tests/compose-configuration.test.mjs`: native Compose overrides and private local configuration.
- `tests/postgres-integration.mjs`: automatic `.env` file selection/overrides, PostgreSQL on/off selection, authenticated SQL/CRUD from Pi with one administrator login, no published DB port, and persistent data after recreation. Run separately with `PI_BOX_RECOMMENDED_IMAGE=pi-box:0.2.0 node tests/postgres-integration.mjs`.
- `tests/integration.mjs`: host tests, both image suites, then Compose and PostgreSQL acceptance (Docker only).

The smoke suite checks startup, shared tool availability (including version checks for nano, micro, nnn, bat, ripgrep and fd in both variants), pinned package presence/absence, extension registration (including `/usage` and `/lsp`), Ruff/Biome presence in recommended and absence from base, real LSP diagnostics and CLI formatting on synthetic Python/JavaScript files, image user/permissions and workspace/agent/Git storage (using synthetic credentials) across restart and replacement. Variant reconciliation is covered by the fast host tests, not a separate integration suite. Terminal, Unicode and interactive-session tests are not included. Set `PI_BOX_IMAGE` when running a single smoke suite. The root `package.json` contains only development commands; image dependencies remain in `container/package.json`.

For Podman, select it explicitly and use an image built with that engine:

```bash
PI_BOX_ENGINE=podman \
PODMAN_BIN=/opt/podman/bin/podman \
PODMAN_CONNECTION=podman-machine-default \
PI_BOX_IMAGE=pi-box:0.2.0 \
node tests/smoke.mjs
```

Adjust the executable and connection for your installation. For Docker outside PATH, set `DOCKER_BIN` to its full path. It uses uniquely named containers/volumes and synthetic data, not live volumes or
model credentials. Smoke-test containers are network-disabled and do not publish
ports. SSH access itself requires manual verification on your devices. Successful
runs clean up owned resources; failures retain resources for inspection. Do not
use global prune.

## Release status

Local release candidate. Both image variants and the Compose lifecycle/persistence
suite, plus optional PostgreSQL SQL/persistence, have been verified on Apple
Silicon macOS with Docker Desktop and Pi 1.3.0.
See the runtime manifest for current pins. CI is configured to build and test
both variants plus Compose/PostgreSQL acceptance on native Linux AMD64 and ARM64 runners.
Interactive terminal/SSH checks, Windows-host acceptance and registry publishing
remain deferred. No model calls, provider-usage requests or credentialed login
were tested. Podman's image smoke runner remains available, but the supported
lifecycle now requires Docker Compose. Debian packages are not snapshot-pinned,
so rebuilds are not bit-for-bit reproducible.
License choice, dedicated secret scan and publication review are pending. No open-source reuse license has been chosen yet.
