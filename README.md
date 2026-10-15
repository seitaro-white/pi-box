# Pi Box

Lightweight development container built around the [Pi](https://pi.dev) agent harness. Run locally or SSH into the machine hosting it.

Comes installed with:
- [Pi](https://pi.dev), with pi-subagents, pi-web-access, pi-usage and Plannotator by default (or Pi only)
- [tmux](https://github.com/tmux/tmux/wiki) for persistent, reconnectable sessions
- Git, ripgrep and fd
- Python and uv
- JavaScript tooling: Node.js and npm

This is my personal remote development setup for coding, which I thought I'd share with the world and develop publicly. I primarily SSH into it, but it works as a local development environment too if you're into that.

## Quickstart — install and run locally

Make sure Docker is installed and running. Start from your **host terminal**, in this repository. These commands assume a fresh setup; inspect any existing `pi-box-dev` container or `pi-box-*` volumes before reusing them.

### Everyday commands

From the host terminal in this repository (requires Node.js 18+ and Make on
the host, in addition to Docker):

```bash
make up       # Build, check, and replace the container; retain named volumes
make attach   # Attach separately when ready
```

Individual steps are available as `make build`, `make check` (read-only), and
`make replace`. Replacement ends running sessions. It verifies the existing
volume mounts and refuses to discard the normal container user's non-persistent
Git files or SSH keys. It does not inspect root's home directory.
Git settings and HTTPS credentials live directly in a third volume
at `/home/node/.config/git`; there is no per-replacement backup/restore.
This is a focused check, not a complete backup: files outside the three mounted
directories will be lost. A stopped existing container must be started before
the check can run.

Replacement requires all three documented volume mounts. There is no migration
or reset mode; containers with different mounts must be handled manually.

Override defaults if needed, for example:
`make up IMAGE=pi-box:custom WORKSPACE_VOLUME=my-workspace AGENT_VOLUME=my-agent GIT_VOLUME=my-git`.
Extra or bind mounts require manual replacement. Do not run lifecycle commands
concurrently. Attachment remains separate; `make up` does not launch Pi.

For the recommended image, replacement publishes Plannotator on host loopback
only (`127.0.0.1:19432` → container port `19432`). Use
`make replace PLANNOTATOR_HOST_PORT=29432` for a different host port, or
`make replace PLANNOTATOR_HOST_PORT=` to disable publishing. The container's port
stays `19432`. The base image does not publish a Plannotator port.

The Makefile calls `scripts/dev-container.mjs`, a Node.js ES-module script.
It uses Docker's JSON inspection output for checks and passes the small
`scripts/check-disposable-files.sh` file to the container's shell for file checks.
The manual Docker commands below do not require Node.js on the host.

The equivalent manual commands follow.

### 1. Build the image

```bash
# Default recommended bundle: Pi + subagents, web access, usage and Plannotator.
docker build -t pi-box:0.2.0 .

# Alternatively: Pi without bundled third-party extensions.
docker build --target base -t pi-box:0.2.0-base .
```

`recommended` is the default target; `--target recommended` also selects it explicitly. Both variants include the same development tools. Builds store images locally; nothing is published to a registry. Exact Pi/extension versions are declared in [`container/package.json`](container/package.json).

### 2. Start the container

```bash
docker run -d --name pi-box-dev \
  -v pi-box-workspace:/workspace \
  -v pi-box-agent:/home/node/.pi/agent \
  -v pi-box-git:/home/node/.config/git \
  --cap-drop=ALL --security-opt=no-new-privileges \
  -p 127.0.0.1:19432:19432 \
  pi-box:0.2.0
```

For the base variant, use `pi-box:0.2.0-base` instead of `pi-box:0.2.0` and omit
`-p 127.0.0.1:19432:19432`. Publishing is also optional for recommended if you
do not need browser reviews.

Docker creates the named volumes if they don't exist. `/workspace` stores your projects; `/home/node/.pi/agent` stores Pi settings, login and conversation history; `/home/node/.config/git` stores global Git settings and saved HTTPS credentials. `--cap-drop` and `--security-opt` restrict privileges. The image prepares these directories for the non-root user; an existing volume with incompatible ownership requires manual repair.

### 3. Open a container shell, attach to tmux, and start Pi

On your host:

```bash
docker exec -it pi-box-dev bash
```

Inside the container:

```bash
tmux attach-session -t '=shell'
```

Once attached to the tmux session:

```bash
cd /workspace
pi
```


**Detach with Ctrl+B, then D.** The tmux session and Pi keep running while the container and host remain running. If you entered through Bash, type `exit` afterward to leave that extra shell.

To reconnect directly from the host:

```bash
docker exec -it pi-box-dev tmux attach-session -t '=shell'
```

This returns to the existing session—if Pi is already running there, don't start another instance. For VS Code, use **Dev Containers: Attach to Running Container…**.

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

### 3. One-time laptop setup for Plannotator (recommended image)

On the **client laptop**, add an entry to `~/.ssh/config`, replacing the placeholders:

```sshconfig
Host macbox
    HostName YOUR_HOST_TAILSCALE_ADDRESS
    User YOUR_HOST_USERNAME
    LocalForward 127.0.0.1:19432 127.0.0.1:19432
    ExitOnForwardFailure yes
```

Already using `ssh macbox`? Keep your existing entry and add only the
`LocalForward` and `ExitOnForwardFailure` lines. No Plannotator installation is
needed on the laptop—just SSH and a browser. The base image needs no forwarding.

### 4. Connect, attach and open reviews

From your laptop:

```bash
ssh macbox
```

Then, in the host's SSH shell, attach as usual:

```bash
docker exec -it pi-box-dev tmux attach-session -t '=shell'
```

Inside Pi, run `/plannotator-plan-mode` (or start with `pi --plan`). Once a plan
is submitted, click its link to open `http://localhost:19432` in your **laptop's
browser**; it does not open automatically. Keep SSH connected—nothing extra is
needed per review. `/plannotator-review`, `/plannotator-annotate FILE.md` and
`/plannotator-last` work the same way.

Detach with **Ctrl+B, then D**, then `exit` to close SSH. Pi continues on the
host. For local use, open the same URL on the Docker host without a tunnel.

The port only answers while a review is open. Finish one before opening another:
port `19432` is shared by Pi sessions. Upstream remote mode
(`PLANNOTATOR_REMOTE=1`) disables live-app annotation and Ask this session.

#### Custom ports and troubleshooting

- For host port `29432`, change the second address in `LocalForward` to
  `127.0.0.1:29432`; the laptop URL stays unchanged.
- If the laptop's port is busy, change the first address's port and use it in
  the browser URL. Reconnect SSH after changing its configuration.
- Check SSH errors, host TCP-forwarding permissions, `docker port pi-box-dev`,
  and that a review is open. New Docker port mappings require container
  replacement, not just an image rebuild.

**Keep Docker publishing bound to `127.0.0.1`, not `-p 19432:19432`.** Reviews
can reveal files and submit decisions. Local processes and containers on the
same Docker network may still reach them. No extra router or Tailscale port
rule is needed beyond SSH.

The host must stay awake and online, with Tailscale, Docker and the container running. Stopping/restarting the container or host ends running work; saved conversations can be resumed manually. Windows-host SSH instructions and VM/cloud deployment are not covered yet.

## Safety and persistence

The container runs as a non-root user, drops Linux capabilities and mounts neither your host home directory nor a container-engine socket. These reduce privileges but are **not a complete agent sandbox**. Pi can access container credentials, mounted data and outbound networking. Extensions use upstream defaults; review their capabilities and resource limits for your workload.

Only `/workspace`, `/home/node/.pi/agent`, and `/home/node/.config/git` persist through container replacement with the documented mounts. Files and installations elsewhere may disappear. Don't run multiple containers against the same writable volumes. Existing Pi/extension settings are retained when rebuilding; image changes don't reset operator preferences. Startup registers the current image's bundled packages by default and removes obsolete image-owned references when switching variants. It preserves unrelated user-installed packages, credentials, history and resource filters for retained packages. The base image does not disable packages you installed yourself in the persistent volume. Switching to base removes the bundled packages' settings entries, including their resource filters; switching back seeds default registrations.

**Persistent volumes are not backups.** You are responsible for recovery. Volume exports can contain credentials and private conversations; never commit or publicly upload them. Deleting/resetting the container engine's VM can destroy its volumes.

## Updating Pi and extensions

Run `make versions` to compare the pinned Pi, extension and override versions with npm's `latest` dist-tags (requires Node.js, npm and registry access). This is read-only; lookup failures produce a nonzero exit status. A different version is not necessarily newer or compatible.

Edit the exact versions in **`container/package.json`**. Pi is the base dependency; every other direct dependency is treated as a bundled Pi package. To add or remove an extension, add or remove its dependency there. Keep exact versions, not `latest`, `^` or `~` ranges.

Regenerate the derived base manifest, package registrations and both lockfiles:

```bash
node container/prepare-runtime.mjs recommended
node container/prepare-runtime.mjs base container/base
npm --prefix container install --package-lock-only --ignore-scripts --no-audit --no-fund
npm --prefix container/base install --package-lock-only --ignore-scripts --no-audit --no-fund
```

Do not hand-edit `container/base/package.json` or either `defaults/settings.json`; they are derived from the authoritative manifest. Commit the manifest, generated files and both lockfiles together. Builds derive their manifests/registrations again and use `npm ci` with lifecycle scripts disabled; a mismatched lockfile fails the build. Rebuild both variants and run the tests below before using a new dependency set. This does not update or replace any existing container automatically.

## Development tests

Run focused host tests with Node's built-in runner—no dependency installation, container engine or model calls needed. They cover manifest consistency, fresh defaults, operator-state preservation, variant switching, legacy migration and safe refusal of broken settings:

```bash
npm test
```

After building both variants, explicitly opt into the full integration suite:

```bash
npm run test:integration
```

This runs the host tests and both image smoke suites. For different image tags:

```bash
PI_BOX_BASE_IMAGE=pi-box:my-base \
PI_BOX_RECOMMENDED_IMAGE=pi-box:my-recommended \
npm run test:integration
```

Test organization:
- `tests/*.test.mjs`: named `node:test` suites; each stateful test has its own temporary directory and automatic cleanup.
- `tests/fixtures/`: container assertions and synthetic state, kept separate from shell scripts.
- `tests/helpers/`: shared setup, cleanup and engine selection.
- `tests/*.sh`: container lifecycle orchestration only. Individual image suites can also be run with `bash tests/smoke.sh` or `PI_BOX_PROFILE=base bash tests/smoke.sh`.

The smoke suite checks startup, pinned package presence/absence, extension registration (including `/usage` and Plannotator commands), image user/permissions and workspace/agent/Git storage (using synthetic credentials) across restart and replacement. Variant reconciliation is covered by the fast host tests, not a separate integration suite. Terminal, Unicode and interactive-session tests are not included. Set `PI_BOX_IMAGE` when running a single smoke suite. The root `package.json` contains only development commands; image dependencies remain in `container/package.json`.

For Podman, select it explicitly and use an image built with that engine:

```bash
PI_BOX_ENGINE=podman \
PODMAN_BIN=/opt/podman/bin/podman \
PODMAN_CONNECTION=podman-machine-default \
PI_BOX_IMAGE=pi-box:0.2.0 \
bash tests/smoke.sh
```

Adjust the executable and connection for your installation. For Docker outside PATH, set `DOCKER_BIN` to its full path. It uses uniquely named containers/volumes and synthetic data, not live volumes or
model credentials. Storage/registration checks are network-disabled. A separate
disposable recommended container uses networking with an ephemeral host-loopback
port to verify the real Plannotator UI and plan API through Docker publishing.
The laptop-to-host SSH tunnel itself requires manual verification on your devices. Successful runs clean up owned resources; failures retain resources for inspection. Do not use global prune.

## Release status

Local release candidate. **Both base and recommended targets built and smoke-tested on Apple Silicon macOS with Docker Desktop, using Pi 1.2.0.** The recommended bundle pins pi-subagents 0.78.0, pi-web-access 0.40.0, `@narumitw/pi-usage` 0.66.0 and `@plannotator/pi-extension` 0.28.19. The current tests cover 19 focused host cases (including variant reconciliation), image startup, pinned package presence/absence, extension tools and command registration, the real Plannotator UI/API through host-loopback publishing, user/permissions and restart/replacement persistence. Terminal and interactive-session checks are deferred. No model calls, provider-usage requests or credentialed login were tested. Earlier prototype acceptance used ARM64 macOS/Podman; these new variants have not been tested on Podman. AMD64, Linux-host and Windows-host acceptance remain pending under issue #4; CI and registry publishing are deferred. Debian packages are not snapshot-pinned, so rebuilds are not bit-for-bit reproducible.
sd
License choice, dedicated secret scan and publication review are pending. No open-source reuse license has been chosen yet.
