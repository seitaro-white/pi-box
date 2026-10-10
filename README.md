# Pi Box

Lightweight development container built around the [Pi](https://pi.dev) agent harness. Run locally or SSH into the machine hosting it.

Comes installed with:
- [Pi](https://pi.dev), with pi-subagents and pi-web-access
- [tmux](https://github.com/tmux/tmux/wiki) for persistent, reconnectable sessions
- Git, ripgrep and fd
- Python and uv
- JavaScript tooling: Node.js and npm

This is my personal remote development setup for coding, which I thought I'd share with the world and develop publicly. I primarily SSH into it, but it works as a local development environment too if you're into that.

## Quickstart — install and run locally

Make sure Docker is installed and running. Start from your **host terminal**, in this repository. These commands assume a fresh setup; inspect any existing `pi-box-dev` container or `pi-box-*` volumes before reusing them.

### 1. Build the image

```bash
docker build -t pi-box:0.2.0 .
```

### 2. Start the container

```bash
docker run -d --name pi-box-dev \
  -v pi-box-workspace:/workspace \
  -v pi-box-agent:/home/node/.pi/agent \
  --cap-drop=ALL --security-opt=no-new-privileges \
  pi-box:0.2.0
```

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

Only `/workspace` and `/home/node/.pi/agent` persist through container replacement. Files and installations elsewhere may disappear. Don't run multiple containers against the same writable volumes. Existing Pi/extension settings are retained when rebuilding; image changes don't reset operator preferences.

**Persistent volumes are not backups.** You are responsible for recovery. Volume exports can contain credentials and private conversations; never commit or publicly upload them. Deleting/resetting the container engine's VM can destroy its volumes.

## Development tests

Host-only configuration tests (no container engine or model calls):

```bash
node tests/init-agent.mjs
```

After building with Docker:

```bash
bash tests/smoke.sh
```

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

Local release candidate. **Built and smoke-tested on Apple Silicon macOS with Docker Desktop, using Pi 1.1.0 (2026-10-10).** Tests cover extension loading, two offline Pi sessions, terminal detach/disconnect, Unicode rendering, and restart/replacement persistence. No model calls or credentialed login were tested. Earlier prototype acceptance used ARM64 macOS/Podman; the new engine-selection path has not been rerun on Podman. AMD64, Linux-host and Windows-host acceptance are pending. Debian packages are not snapshot-pinned, so rebuilds are not bit-for-bit reproducible.

License choice, dedicated secret scan and publication review are pending. No open-source reuse license has been chosen yet.
