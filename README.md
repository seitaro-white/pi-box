# Pi Box

A Linux container for [Pi](https://pi.dev), with coding tools, persistent workspaces, and tmux sessions you can detach from and rejoin.

Includes **pi-subagents** and **pi-web-access** with upstream defaults. No model credentials are included. A core-only installation example is planned.

## Quick start

You need Docker installed and running. Run steps 1–3 in your **host terminal**, from this repository. These commands assume a new installation; if you already have a `pi-box-dev` container or `pi-box-*` volumes, inspect them before reusing them. Do not run two containers against the same workspace/Pi-state volumes.

### 1. Build the image

```bash
docker build -t pi-box:0.2.0 .
```

### 2. Start the container

```bash
docker run -d --name pi-box-dev \
  --cap-drop=ALL --security-opt=no-new-privileges \
  -v pi-box-workspace:/workspace \
  -v pi-box-agent:/home/node/.pi/agent \
  pi-box:0.2.0
```

Docker creates the named volumes if they do not exist:

- **`pi-box-workspace`** stores your projects.
- **`pi-box-agent`** stores Pi settings, login and conversation history.

The container starts a Bash shell inside tmux—not Pi itself.

### 3. Attach to the shell

```bash
docker exec -it pi-box-dev tmux attach-session -t '=shell'
```

### 4. Start Pi inside the container

```bash
mkdir -p /workspace/my-project
cd /workspace/my-project
pi
```

Use `/login` in Pi to authenticate. Search providers and other optional extension features may need separate configuration; installed does not mean configured.

**Detach:** press **Ctrl+B**, then **D**. Pi continues while the container and host stay running. Reattach using step 3. Host sleep, shutdown and container restart interrupt work.

## Everyday commands

Run these on the host:

```bash
docker ps                          # list running containers
docker stop pi-box-dev             # end ALL sessions/jobs in this container
docker start pi-box-dev            # restart with a fresh shell
```

After restarting, attach again, return to your project directory and run `pi --continue` or `pi --resume`. Saved conversations can be resumed; running processes cannot.

For VS Code, use **Dev Containers: Attach to Running Container…** and choose `pi-box-dev`.

## Rebuild and update

First build the updated image; this does not interrupt the running container:

```bash
docker build -t pi-box:0.2.0 .
```

When all users have finished their work, stop and remove the old container:

```bash
docker stop pi-box-dev
docker rm pi-box-dev
```

Then repeat **steps 2 and 3** above. Reusing the same named volumes preserves projects and Pi state. **Do not delete the volumes or add a volume-removal option.** Reconnect terminals/VS Code and resume Pi manually.

Files and installed tools outside `/workspace` and `/home/node/.pi/agent` may disappear on replacement. Existing Pi settings are retained; rebuilding does not reset operator preferences or remove configuration seeded by earlier versions.

## What's included

- Node 24.21.0, Pi 1.0.2, pi-subagents 0.76.0 and pi-web-access 0.36.0.
- uv 0.12.23, Python 3.13.16, Bash, Git, ripgrep, fd and tmux.
- UTF-8 terminal defaults and tmux mouse support.

Startup adds the installed extension package paths to Pi settings. It does not seed custom extension policy files, limit concurrency or disable built-in agents; package resources and policies use upstream defaults. Existing user configuration is left intact. Additional uv tools/interpreters use configured locations in the Pi-state volume.

## Podman and SSH (optional)

The same Dockerfile can be built with Podman. Use your selected engine in place of `docker` in the commands above. On macOS, explicitly select the intended Podman connection; rootful and rootless connections have separate container inventories.

For a Mac installation with the following executable/connection, define this function and use `p` in place of `docker`:

```bash
p() { /opt/podman/bin/podman --connection podman-machine-default "$@"; }
```

Use the same engine for build, run and attach. Do not switch your global default just for this project. The optional helper requires a rootless connection. For a new setup using that helper, create its labelled volumes **before** step 2:

```bash
p volume create --label io.pi-box.project=pi-box pi-box-workspace
p volume create --label io.pi-box.project=pi-box pi-box-agent
```

Creating an existing volume does not relabel or validate it; inspect existing resources before reuse.

### Optional `pibox` helper

`scripts/pibox` currently supports **Mac Podman hosts and SSH clients**, not Docker. Copy it into `~/.local/bin/`, make it executable, and create `~/.config/pibox/config` from `config/pibox.local.example`, adjusting values for your machine. This user-owned file is trusted Bash configuration.

```bash
pibox up             # starts only the existing VM/container
pibox sessions       # lists sessions without starting anything
pibox attach         # joins the existing shell; does not launch Pi
pibox attach NAME    # joins another existing session
pibox stop           # ends ALL container jobs/sessions; retains volumes
```

For another laptop, install the same helper there and use `config/pibox.remote.example`. Set an SSH host alias and the absolute helper path on the Mac. The client needs SSH, not Podman. Configure connectivity, host trust and host power settings separately.

For VS Code with Podman, point `dev.containers.dockerPath` at an executable wrapper on the Mac:

```sh
#!/bin/sh
exec /opt/podman/bin/podman --connection podman-machine-default "$@"
```

With VS Code Remote SSH, configure this in the Mac's remote settings, not the client's local settings.

## Safety and persistence

The container runs as a non-root user, drops Linux capabilities and mounts neither your host home directory nor a container-engine socket. These reduce privileges but are **not a complete agent sandbox**. Pi can access container credentials, mounted data and outbound networking. Review extension capabilities and resource limits for your workload.

**Persistent volumes are not backups.** You are responsible for recovery. Volume exports can contain credentials and private conversations; never commit or publicly upload them. Deleting/resetting the container engine's VM can destroy its volumes. No backup tooling is provided.

## Development tests

Host-only tests (no real container engine or model calls):

```bash
node tests/init-agent.mjs
python3 tests/pibox-unit.py
python3 tests/pibox-ssh-timeout.py  # bounded loopback SSH test
```

The container smoke suite currently uses **Podman**, not Docker. After building with Podman:

```bash
PODMAN_BIN=/opt/podman/bin/podman \
PODMAN_CONNECTION=podman-machine-default \
PI_BOX_IMAGE=pi-box:0.2.0 \
bash tests/smoke.sh
```

It uses uniquely named network-disabled containers/volumes and synthetic data, not live volumes or model credentials. Successful runs clean up owned resources; failures retain resources for inspection. Do not use global prune.

## Release status

Local release candidate, not yet published. Earlier container acceptance used ARM64 macOS/Podman; **the simplified image still needs a fresh build and smoke test, and Docker usage has not been runtime-validated**. ARM64/AMD64 manifests are available for the pinned base, but AMD64 runtime acceptance is pending. Debian packages are not snapshot-pinned, so rebuilds are not bit-for-bit reproducible.

License choice, dedicated secret scan and publication review are also pending. No open-source reuse license has been chosen yet.
