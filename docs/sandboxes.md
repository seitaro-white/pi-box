# Docker Sandboxes

Optional micro-VM runtime alongside Compose. `make up` remains Compose-based;
there is no custom sandbox lifecycle script or Make wrapper. Use sbx's native
**experimental** environment-file commands (tested with sbx v0.49.2 on Apple
Silicon macOS). Compose remains the primary development workflow, with reusable
named volumes. The sandbox is an optional isolation-first alternative.

**Storage:** the default sandbox retains files across stop/start, but deleting it
deletes its internal repositories and login. Local sbx v0.49.2 does not support
reattachable named volumes (`sbx volume` is cloud-only). For storage independent
of the sandbox, see [optional shared storage](#optional-shared-storage).

## Quick reference

Run from this checkout after the [one-time host setup](#one-time-host-setup):

```bash
# Preview what will be created; no changes made.
sbx env plan ./sbxenv.yaml

# First time: build the image and create the persistent, mountless sandbox.
sbx env create ./sbxenv.yaml

# Start/rejoin a plain shell. Start Pi or tmux yourself inside it.
sbx env exec -it ./sbxenv.yaml -- bash -l
# Inside the sandbox: cd ~/workspace; clone your repo; run pi.
# First Pi session: /login → OpenAI/Codex.

# Alternatively, start in the background without entering a shell.
sbx env run --detach ./sbxenv.yaml

# Show environments, or stop this one (files/login stay; processes end).
sbx ls
sbx stop pi-sandbox
```

The default name is **`pi-sandbox`**, separate from the regular Compose setup
and any older `pi-box` sandbox. Existing sandboxes are not renamed or deleted.
If your checkout folder isn't `pi-box-public`, adjust `agent` in `sbxenv.yaml`
to match it first; the agent name is separate from the sandbox name.

Routine use does **not** require rebuilding. Image changes need a new sandbox;
stop/start keeps the existing files and login. See [updates and deletion](#updates-tests-and-deletion)
before replacing anything.

## Files

- **`sbxenv.yaml`** selects the local kit, sandbox name, and disables shared skills.
  No `workspace` means no host project/home directory is mounted.
- **`pi-box.yaml`** describes the kit: persistent background operation and default
  4 CPUs/4 GiB RAM. It selects `sandbox/pi-box.dockerfile`.
- **`sandbox/pi-box.dockerfile`** installs pinned tools/extensions and registers
  non-secret Pi defaults at build time. Shell/Pi/tmux sessions are manual.
- **`.dockerignore`** restricts the standard build context to reviewed inputs.
  No temporary staging helper or Docker Desktop is required for native creation.

Bundled Python/Ruff/Pi stay in image-owned `/opt` locations, with commands on
`PATH`. Later uv installs use normal user defaults (`~/.local/share/uv` and
`~/.local/bin`); Pi uses `~/.pi/agent`. The image does not override uv link mode
or Pi's default version-check/telemetry behaviour.

For local kits, sbx requires `agent` in `sbxenv.yaml` to match the **checkout
folder's name**. The checked-in value is `pi-box-public`, matching this checkout.
If you clone into a different folder, change that one value (not `name`, which
names the sandbox). This is an sbx requirement, not a Pi model/provider choice.

## One-time host setup

```bash
brew trust docker/tap
brew install docker/tap/sbx
sbx login
```

For a fresh installation, choose allow-all outbound networking:

```bash
sbx policy init allow-all
```

For an existing initialized baseline, broaden it without resetting other rules:

```bash
sbx policy allow network '**'
```

This is **host-global**. Explicit denies still win; experimental UDP/ICMP runtime
restrictions are unchanged. Open networking cannot read host files by itself,
but can transmit anything readable inside the sandbox, including Codex tokens.

Disable SSH forwarding if you don't need it (also host-global):

```bash
sbx settings set ssh.agentForwardingEnabled false
sbx daemon restart
```

Finish other sandbox sessions before restarting the daemon. No custom wrapper
checks this setting now: review it yourself. Forwarding keeps private keys on
the host but lets sandbox processes request authentication using them.

For GitHub, authenticate `gh` on the host if necessary, then register a resolver:

```bash
gh auth login
sbx secret set github --command 'gh auth token'
```

The resolver runs on the host; real GitHub tokens stay outside the sandbox.
Prefer narrowly scoped credentials. Proxying hides the token, not the ability
to make authorized requests. Do not paste tokens into configuration or Git.

## Create and use

From this checkout, use an explicit environment path to avoid unrelated
`~/.sbxenv.yaml` defaults:

```bash
sbx env plan ./sbxenv.yaml
sbx env create ./sbxenv.yaml
sbx env exec -it ./sbxenv.yaml -- bash -l
```

Creation builds the local kit automatically, with cached image layers. Review
and approve the plan. There are no declared host lifecycle commands, workspace
mounts, or model secrets. The kit keeps the VM running after clients disconnect.

An older `pi-box` sandbox can coexist with the default `pi-sandbox`; do not
delete it to adopt this file. For an additional trial, use another name
consistently on each command:

```bash
sbx env plan --name pi-sandbox-trial ./sbxenv.yaml
sbx env create --name pi-sandbox-trial ./sbxenv.yaml
sbx env exec -it --name pi-sandbox-trial ./sbxenv.yaml -- bash -l
```

Inside the sandbox:

```bash
cd ~/workspace
git clone https://github.com/OWNER/REPOSITORY.git
cd REPOSITORY
pi
```

Use Pi **`/login` → OpenAI/Codex**, completing the browser/pasted callback flow
or device-code flow if offered. **Access/refresh tokens live inside the sandbox**
and are readable by its processes. Keep them out of logs, traces, Git, and saved
images. The kit never seeds or rewrites `auth.json`.

Set Git identity separately with `git config --global user.name` and
`git config --global user.email`. Host-proxied GitHub API and private HTTPS Git
reads were verified; write testing needs an approved disposable branch.

## Everyday commands

```bash
sbx env run --detach ./sbxenv.yaml           # create/start without attaching
sbx env exec -it ./sbxenv.yaml -- bash -l   # plain shell
sbx env exec -it ./sbxenv.yaml -- pi        # direct Pi invocation
sbx ls
sbx stop pi-sandbox                        # keeps files, ends processes
```

Your aliases can still use `sbx exec -it pi-sandbox bash -l` directly. Manage tmux
yourself if wanted, e.g. `tmux new-session -A -s dev`. SSH to the hosting Mac to
use the same commands remotely. The Mac must stay awake/online. Neither stop
nor reboot preserves live Pi/tmux processes; workspace and login files persist.

## Optional shared storage

Local sbx supports sharing a **host directory**, not attaching an existing Docker
named volume. Use a dedicated directory on the **sandbox host** (not each SSH
client), containing only data you intend Pi to access. This is optional; the
checked-in environment stays mountless.

For example, on the host, replace `/absolute/path/to/pi-box-data` with your chosen
absolute path everywhere below:

```bash
mkdir -p /absolute/path/to/pi-box-data/repos /absolute/path/to/pi-box-data/state/pi
chmod 700 /absolute/path/to/pi-box-data /absolute/path/to/pi-box-data/state
```

Create a private `sbxenv.local.yaml` beside `sbxenv.yaml`:

```yaml
name: pi-sandbox-shared
workspace: /absolute/path/to/pi-box-data
env:
  PI_CODING_AGENT_DIR: /absolute/path/to/pi-box-data/state/pi
  GIT_CONFIG_GLOBAL: /absolute/path/to/pi-box-data/state/gitconfig
```

The host directory is shared read-write **at the same absolute path inside the
sandbox**. The sandbox starts there, not at `~/workspace`. `repos/` holds Git
checkouts and `state/` holds Pi/Git settings separately from those repositories.
If you only want shared repositories, omit the `env` section: Pi login and Git
settings will then remain inside the sandbox and be lost on its deletion.

Use both files, in the same order, for every environment command:

```bash
sbx env plan ./sbxenv.yaml ./sbxenv.local.yaml
sbx env create ./sbxenv.yaml ./sbxenv.local.yaml
# Once for a new shared Pi state directory: seed non-secret extension defaults.
sbx env exec ./sbxenv.yaml ./sbxenv.local.yaml -- node /opt/pi/init-agent.mjs
sbx env exec -it ./sbxenv.yaml ./sbxenv.local.yaml -- bash -l
# Inside: cd repos; clone your repositories; run pi and /login.
# Set Git user.name/user.email normally; GIT_CONFIG_GLOBAL persists them.
```

No separate Git volume is needed: the Git configuration file is in `state/`,
and the GitHub token still comes from the host proxy. With the `env` section,
Codex login/settings/history are in the shared Pi directory. User-installed uv
tools and other files elsewhere inside the sandbox are **not** persisted by this
example.

**Security trade-off:** Pi can modify/delete everything in the shared directory,
and can read its Codex tokens. Keep it private and out of Git/backups you share;
do not mount your home directory, SSH keys, or host credential stores. Sharing
state across sandboxes also shares that trust boundary; avoid concurrent use of
the same Pi state directory.

Mount changes require a **new sandbox**. This example uses a different name and
doesn't alter an existing mountless sandbox. Shared host files survive sandbox
removal, but aren't automatically backed up. Review the destroy plan before
removing/recreating anything; don't delete the host directory. These instructions
follow the native environment-file interface; this shared-storage variant has
not been live-tested here.

## Updates, tests, and deletion

Code changes inside repositories need no rebuild. Image/kit changes apply to
**newly created** sandboxes, not existing ones. Create a differently named trial,
clone/push repositories, and log in again when using the mountless default.
With optional shared storage, reuse that host directory instead. No lifecycle
command upgrades an existing filesystem in place. Run `plan` before applying changes. `sbx env` and
its file format are experimental.

```bash
npm test                              # no sbx/KVM/login required
sbx kit validate .                    # live kit build/validation
node tests/sandbox-smoke.mjs          # live check of existing pi-sandbox
# Optional restart test ends running sessions:
SANDBOX_NAME=pi-sandbox-trial PI_BOX_SANDBOX_RESTART=1 node tests/sandbox-smoke.mjs
```

CI builds/smoke-tests the sandbox Dockerfile with ordinary Docker on AMD64 and
ARM64, without sbx or credentials. Live micro-VM and login checks are separate.

`sbx env rm ./sbxenv.yaml` is **destructive**: it deletes repositories,
credentials, and history stored internally (not optional shared host files). Review its plan; don't use it for routine updates.
Back up/push all branches and account for ignored/untracked files first. Never
publish snapshots of logged-in sandboxes or use global pruning for migration.
Compose storage is independent and is not migrated or deleted by this workflow.

Optional sidecars and remote/cloud deployment are deferred.
Web/search providers still need their own authentication; Codex login doesn't
configure them.
