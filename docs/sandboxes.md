# Docker Sandboxes (initial macOS workflow)

This is an opt-in replacement runtime alongside the existing Compose workflow.
`make up` and existing CI still use Compose. Nothing here imports
or deletes existing Docker volumes.

Tested with **sbx v0.49.2 on Apple Silicon macOS**. Local `sbx` does not require
Docker Desktop. It builds the environment inside its own managed builder and
runs Pi inside a micro-VM. This is stronger isolation, not protection against
malicious changes to repositories or disclosure of credentials kept inside it.

## Host prerequisites

Install and sign in interactively:

```bash
brew trust docker/tap
brew install docker/tap/sbx
sbx login
sbx version
```

This workflow uses **allow-all outbound networking**, like ordinary Docker
connectivity, rather than maintaining a project destination allowlist. On a
fresh sbx installation:

```bash
sbx policy init allow-all
```

If a baseline is already initialized (such as balanced), do not reset policies.
Add a global catch-all rule instead, preserving filesystem and other settings:

```bash
sbx policy allow network '**'
```

These are **host-global policy changes**, affecting other local sbx sandboxes.
Existing explicit deny rules still take precedence. The catch-all enables TCP
access to all destinations/ports; it does not enable experimental UDP or remove
other runtime isolation. Inspect `sbx policy ls` to see effective policies.

Open networking does not expose host files or real proxy-managed GitHub tokens,
but code can transmit anything readable inside the sandbox, including Codex
login tokens. This is an accepted convenience/security trade-off.

Disable SSH-agent forwarding (also host-global, affecting other sbx sandboxes):

```bash
sbx settings set ssh.agentForwardingEnabled false
sbx daemon restart
```

The wrapper refuses creation while forwarding is enabled. Existing sessions
should be finished before restarting the daemon. sbx may still set SSH_AUTH_SOCK
inside the VM; the important check is that it points to no usable socket.

For GitHub, authenticate `gh` **on the host**, then register a host-side resolver:

```bash
gh auth login
sbx secret set github --command 'gh auth token'
```

Skip `gh auth login` if already signed in. The host's existing token can be reused;
a new token is not inherently required. Prefer a dedicated, narrowly scoped token
if the host login has broader permissions than this environment needs. The
resolver is stored rather than copying the token into the image or workspace.
The built-in sbx shell kit provides GitHub proxy authentication. It can still
make authorized requests and pushes: hiding the token does not limit its scope.

## Create and use

From this repository:

```bash
make sandbox-create
make sandbox-start
make sandbox-shell
```

Creation builds pinned development tools and extensions from reviewed files. It
shares **no host workspace**, disables shared skills, and defaults to 4 CPUs and
4 GiB RAM. The build context is a temporary allowlisted directory, not this
checkout, your home, or `.env`. No Docker Engine image store is assumed.

This opens a plain login shell; no Pi process or tmux session is started for you.
You can also enter directly with `sbx exec -it pi-box bash -l`. Inside it:

```bash
cd ~/workspace
git clone https://github.com/OWNER/REPOSITORY.git
cd REPOSITORY
pi
```

In Pi, use **`/login` → OpenAI/Codex**. Complete the browser/pasted-callback flow,
or device-code login if offered by the pinned Pi version. No model API key or
host OAuth proxy configuration is required. A callback reaching localhost on
your client rather than the sandbox is not a reason to expose a public port;
use the offered manual callback/device flow instead.

**Codex access and refresh tokens live inside the sandbox**, readable by Pi and
its commands. They persist across stop/start. Keep them out of Git, traces,
logs, template snapshots, and published images. This is an accepted trade-off,
not equivalent to proxy-managed model credentials. We never seed or replace
Pi's auth.json from kit configuration.

Git identity is independent of authentication. Set a non-secret identity inside
the sandbox before committing:

```bash
git config --global user.name 'Your Name'
git config --global user.email 'you@example.com'
```

HTTPS Git access uses the host proxy; no plaintext credential-store helper is
installed. GitHub API and private Git read access were verified. A write test
requires an explicitly chosen disposable branch/repository; it is not performed
by the smoke test. Non-GitHub hosting needs separate configuration.

## Lifecycle and SSH

```bash
make sandbox-status
make sandbox-shell       # plain shell; sessions are managed manually
make sandbox-stop        # retains files, but ends running processes
make sandbox-start       # keeps the VM running without connected clients
```

Manage sessions yourself, for example `tmux new-session -A -s dev` inside the
sandbox. No tmux configuration or session launcher is supplied by the sandbox
image. You can invoke Pi directly with `sbx exec -it pi-box pi` too; use your own
session-management approach if the process must survive a disconnect.

To reconnect remotely, SSH to the Mac host, enter with `sbx exec -it pi-box bash -l`,
and attach to any session you created yourself. Connecting clients need SSH
access only, not Codex/GitHub credentials. The Mac must remain awake and online.
Detached mode keeps the VM running without clients; it does not preserve live
processes across host reboot or sandbox stop.

Set a distinct name without editing `.env`:

```bash
SANDBOX_NAME=pi-box-experiment make sandbox-create
SANDBOX_NAME=pi-box-experiment make sandbox-start
```

The wrapper deliberately does not load Compose's `.env`. Create refuses to
replace an existing name; start/shell refuse a missing name. They never use
bare `sbx run AGENT`, which could implicitly share the current host directory.

## sbx v0.49.2 compatibility path

This version builds v3 workloads but rejects a custom agent identity during
creation. The wrapper therefore:

1. Builds/inspects the v3 descriptor using sbx's managed builder.
2. Extracts the resulting image reference and resource limits.
3. Creates the built-in **shell** agent with that image, with no project
   network-policy mixin; host network policy applies.
4. Opens a plain shell when requested. Pi's non-secret extension registrations
   are already initialized in the image at build time.

This avoids overriding a built-in agent or duplicating shell's GitHub credential
service (both rejected by this version). There is no custom session launcher.
The source v3 long-running request is not applied by this template-based path;
**run `make sandbox-start` for detached persistence**.
The shell kit can run its own package setup at startup. Existing sandboxes do
not acquire kit/image changes merely because source files changed.

## Tests and updates

```bash
npm test                     # no sbx installation/login required
make sandbox-validate        # live builder validation; not an offline check
node tests/sandbox-smoke.mjs  # live tools/config check; no model or Git writes
# Explicitly destructive to running processes, but retains files:
PI_BOX_SANDBOX_RESTART=1 node tests/sandbox-smoke.mjs
```

Normal CI continues to build/smoke-test the existing images and Compose path.
Host-side tests cover sandbox command safety and staging. Live sbx testing is
opt-in on a compatible host; it is not assumed available on all CI runners.

For image changes, create a differently named sandbox and validate it. Push all
work first, clone again, and repeat `/login` there. Do not snapshot a logged-in
sandbox to produce a distributable image. The current wrapper intentionally has
no remove, recreate, reset, or prune command.

## Cutover and deletion

Do not delete old Compose volumes until the sandbox works for your actual Codex
account and Git workflow. Verify all branches and unpushed/untracked/ignored
files; a Git push does not save arbitrary workspace files. Optional database or
trace volumes need a separate retention decision.

Removing a sandbox deletes its internal repositories, credentials, and history.
Stop/start retains them; deletion/recreation does not. Review exact names and
confirm before using `sbx rm` or removing old Docker volumes. Never use global
pruning as migration cleanup. Rotate/revoke superseded credentials where needed;
volume deletion is not guaranteed secure erasure.

## Deferred

Optional PostgreSQL, Browserless, Phoenix, host folder sharing, and remote/cloud
hosting are not integrated into this initial workflow. Web extensions may need
their own authentication; Codex login does not
configure unrelated providers. These are not automatically inherited from the
old agent volume or host Pi configuration.
