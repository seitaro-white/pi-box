# Pi Box

Lightweight development container built around the [Pi](https://pi.dev) agent harness. Can be run locally or remotely (via home server or VM)

Comes installed with:
- [Pi](https://pi.dev) (agent harness)
- [tmux](https://github.com/tmux/tmux/wiki) (for session management)
- git, ripgrep, fd
- python (uv)
- JS (node, npm)

This is my personal remote dev setup for coding, which I thought I'd share with the world + develop publicly.


## Quickstart - install and run locally

Make sure Docker is installed and running, then run steps 1–3 in your **host terminal** from this repository.

### 1. Build image

```bash
docker build -t pi-box:0.2.0 .
```

### 2. Start container

```bash
docker run -d --name pi-box-dev \
  # Assign volumes if they don't exist
  -v pi-box-workspace:/workspace \
  -v pi-box-agent:/home/node/.pi/agent \
  # Additional privilege restriction
  --cap-drop=ALL --security-opt=no-new-privileges \
  pi-box:0.2.0
```


### 3. Open shell within container and attach with tmux, start pi

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
