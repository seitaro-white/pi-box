# Pi Box

Lightweight development container built around the [Pi](https://pi.dev) agent harness. Run locally or SSH into the machine hosting it.

Comes installed with:
- [Pi](https://pi.dev), with pi-subagents, pi-web-access and pi-usage by default (or Pi only)
- [tmux](https://github.com/tmux/tmux/wiki) for persistent, reconnectable sessions
- Git, ripgrep and fd
- Python and uv
- JavaScript tooling: Node.js and npm

This is my personal remote development setup for coding, which I thought I'd share with the world and develop publicly. I primarily SSH into it, but it works as a local development environment too if you're into that.

## Quickstart — install and run locally

Make sure Docker is installed and running. Start from your **host terminal**, in this repository. These commands assume a fresh setup; inspect any existing `pi-box-dev` container or `pi-box-*` volumes before reusing them.

### 1. Build the image

```bash
# Default recommended bundle: Pi + subagents, web access and usage.
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
  --cap-drop=ALL --security-opt=no-new-privileges \
  pi-box:0.2.0
```

For the base variant, use `pi-box:0.2.0-base` instead of `pi-box:0.2.0` in the run command.

Docker creates the named volumes if they don't exist. `/workspace` stores your projects; `/home/node/.pi/agent` stores Pi settings, login and conversation history. The last two options restrict privileges.

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

From your laptop, replacing the placeholders with the host's account and Tailscale address:

```bash
ssh USER@HOST_TAILSCALE_ADDRESS
```

Then, in the host's SSH shell:

```bash
docker exec -it pi-box-dev tmux attach-session -t '=shell'
```

Detach with **Ctrl+B, then D**, and run `exit` to close SSH. Pi continues on the host. Reconnect with the same commands.

The host must stay awake and online, with Tailscale, Docker and the container running. Stopping/restarting the container or host ends running work; saved conversations can be resumed manually. Windows-host SSH instructions and VM/cloud deployment are not covered yet.

## Safety and persistence

The container runs as a non-root user, drops Linux capabilities and mounts neither your host home directory nor a container-engine socket. These reduce privileges but are **not a complete agent sandbox**. Pi can access container credentials, mounted data and outbound networking. Extensions use upstream defaults; review their capabilities and resource limits for your workload.

Only `/workspace` and `/home/node/.pi/agent` persist through container replacement. Files and installations elsewhere may disappear. Don't run multiple containers against the same writable volumes. Existing Pi/extension settings are retained when rebuilding; image changes don't reset operator preferences. Startup registers the current image's bundled packages by default and removes obsolete image-owned references when switching variants. It preserves unrelated user-installed packages, credentials, history and resource filters for retained packages. The base image does not disable packages you installed yourself in the persistent volume. Switching to base removes the bundled packages' settings entries, including their resource filters; switching back seeds default registrations.

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

Run eight focused host tests with Node's built-in runner—no dependency installation, container engine or model calls needed. They cover manifest consistency, fresh defaults, operator-state preservation, variant switching, legacy migration and safe refusal of broken settings:

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

The smoke suite checks startup, pinned package presence/absence, extension registration (including `/usage`), image user/permissions and workspace/agent storage across restart and replacement. Variant reconciliation is covered by the fast host tests, not a separate integration suite. Terminal, Unicode and interactive-session tests are not included. Set `PI_BOX_IMAGE` when running a single smoke suite. The root `package.json` contains only development commands; image dependencies remain in `container/package.json`.

For Podman, select it explicitly and use an image built with that engine:

```bash
PI_BOX_ENGINE=podman \
PODMAN_BIN=/opt/podman/bin/podman \
PODMAN_CONNECTION=podman-machine-default \
PI_BOX_IMAGE=pi-box:0.2.0 \
bash tests/smoke.sh
```

Adjust the executable and connection for your installation. For Docker outside PATH, set `DOCKER_BIN` to its full path. It uses uniquely named network-disabled containers/volumes and synthetic data, not live volumes or model credentials. Successful runs clean up owned resources; failures retain resources for inspection. Do not use global prune.

## Release status

Local release candidate. **Both base and recommended targets built and smoke-tested on Apple Silicon macOS with Docker Desktop, using Pi 1.2.0 (2026-10-13).** The recommended bundle pins pi-subagents 0.78.0, pi-web-access 0.40.0 and pi-usage 0.10.13. The current tests cover eight focused host cases (including variant reconciliation), image startup, pinned package presence/absence, extension tools and `/usage` registration, user/permissions and restart/replacement persistence. Terminal and interactive-session checks are deferred. No model calls, provider-usage requests or credentialed login were tested. Earlier prototype acceptance used ARM64 macOS/Podman; these new variants have not been tested on Podman. AMD64, Linux-host and Windows-host acceptance remain pending under issue #4; CI and registry publishing are deferred. Debian packages are not snapshot-pinned, so rebuilds are not bit-for-bit reproducible.

License choice, dedicated secret scan and publication review are pending. No open-source reuse license has been chosen yet.
