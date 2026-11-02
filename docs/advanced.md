# Advanced setup and technical details

Detailed configuration, operations and maintenance notes moved out of the [README](../README.md).

## Base image

The default build target is `recommended`. A stripped-down `base` target includes Pi and the shared development tools, but omits Herdr, Hunk (including its skill), the bundled Pi extensions, Claude Code CLI, Ruff, ty and Biome. To select it, set these overrides in your local `.env` before building:

```dotenv
TARGET=base
IMAGE=pi-box:0.2.0-base
```

Both Compose variants include `/AGENTS.md` and a `pi-box` skill with environment
and service instructions. Replacing the image updates these without changing
personal Pi settings; use `/reload` in existing Pi sessions. uv Python/tool
installs persist in the agent volume.

## Git setup

Configure your Git identity inside the container and clone projects into `/workspace`. Git settings and HTTPS credentials persist in the Git volume; host Git configuration and SSH keys are not mounted automatically.

Use `gh` for GitHub PRs, issues and checks. Supply your existing GitHub token as
`GH_TOKEN` in the shell launching Pi; check with `gh auth status`. Git push/pull
keeps using its existing credential helper. CLI config persists in
`/home/node/.config/git/gh`; `GH_TOKEN` must be supplied for each new session.

## Cloud tools

Google Cloud CLI and Terraform are image-owned; see [tool updates](#updating-tools-and-extensions).
Authenticate inside the container with `gcloud auth login --no-launch-browser` and, for Terraform's Google
provider, `gcloud auth application-default login --no-launch-browser`. Credentials
are never baked into the image. Keep Terraform projects and state in `/workspace`;
prefer a remote state backend for shared infrastructure.

If you previously installed these tools in the agent volume, copy your existing
gcloud configuration **before replacing the container** (run on the host):

```sh
docker compose exec pi-box sh -c 'cp -a "$HOME/.config/gcloud" "$HOME/.pi/agent/gcloud" && chmod 700 "$HOME/.pi/agent/gcloud"'
```

This assumes the destination does not already exist. After rebuilding, remove the
old `~/.pi/agent/bin/gcloud` symlink and `~/.pi/agent/bin/terraform` binary so they
no longer shadow the image tools. Once `gcloud version` and `terraform version`
work from the image, remove `~/.pi/agent/tools/google-cloud-sdk` to stop Pi's legacy
custom-tools warning. Do not move the SDK into Pi's `extensions/` directory.

## Docker Sandboxes

An optional mountless micro-VM deployment for Apple Silicon Macs uses native
`sbx env` commands and [`sbxenv.yaml`](../sbxenv.yaml). See the
[sandbox guide](sandboxes.md) for setup, login and storage options.
Internal storage survives stop/start, but not sandbox deletion.

## Web development and browser access

Compose publishes ports **5173–5182** on host loopback. Check `ss -ltnp`, choose
a free port, and bind to **`0.0.0.0`** with automatic port fallback disabled.

For Vite, set the project's dev script (using 5173 as an example):

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173 --strictPort"
  }
}
```

Run `npm run dev`. Pi's optional Browserless browser visits
**`http://pi-box:5173`**; your host browser needs no sidecar.

Use the selected port in both URLs. To remap the ten host ports, set
`DEV_PORTS=15173-15182` in `.env` and run `make up` (ends sessions if Pi is recreated).
Container ports stay 5173–5182.

For remote viewing, run on your client machine:

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:5173:127.0.0.1:5173 your-mac-ssh-alias
```

Visit `http://localhost:5173` while the tunnel is open. Repeat `-L` for additional
ports; use the mapped host port as the destination if you changed `DEV_PORTS`.

## Optional services: PostgreSQL

Optional services are added through Compose overlays. PostgreSQL is included as an example; select it in your private `.env`:

```dotenv
COMPOSE_FILE=compose.yaml:compose.postgres.yaml
POSTGRES_PASSWORD='your-private-password'
```

Run `make up` to build and start the selected services. Pi connects to `postgres:5432` using the supplied `PG*` environment variables; no database port is published to the host. It has database administrator access, so keep this separate from production data. PostgreSQL has its own persistent volume; changing `.env` does not rotate an existing database password.

Combine overlays by appending their filenames to `COMPOSE_FILE`. Stop a sidecar
before removing its overlay; deselecting it alone leaves the container running.

## Optional services: Browserless Chromium

Select the browser overlay in your private `.env`:

```dotenv
COMPOSE_FILE=compose.yaml:compose.browserless.yaml
BROWSER_TOKEN='your-own-strong-private-token'
```

Run `chmod 600 .env` and `make up`. Pi receives `BROWSER_CDP_URL` and
`BROWSER_TOKEN`. See the [Browserless guide](browserless.md) for a client
example and licensing/security details.

## Optional services: Phoenix tracing

Select Phoenix in your private `.env`:

```dotenv
COMPOSE_FILE=compose.yaml:compose.phoenix.yaml
```

Run `make up`, then follow the [Phoenix guide](phoenix.md) to install and
configure `pi-otel`. The UI is at `http://localhost:6006`; traces persist in SQLite.
**Full-content traces can retain prompts, code, tool results and secrets.**

## Tailscale

Tailscale can provide private access to the Docker host or VM. Run it on the host and client, SSH to the host over your tailnet, then run `docker compose exec -it pi-box bash -l` from the repository directory and manage sessions yourself.

The host must remain awake and online.

## Updating tools and extensions

Bundled Pi and extension versions are pinned in [`container/package.json`](container/package.json), except personal skills, which follow `main` at build time. `make versions` checks the npm pins against registry versions without changing anything, and labels Git commit pins without checking upstream. Update Git packages by replacing their full commit hashes in the manifest.

Ruff, ty, Herdr, Hunk, gcloud and Terraform are pinned in
[`container/mise.toml`](container/mise.toml). After editing a version, run the
following with the image's mise version and commit the updated manifest and
lockfile (Linux amd64/arm64 URLs and checksums):

```sh
mise -C container trust
mise -C container lock --platform linux-x64,linux-arm64
```

Bundled tools run directly from `/usr/local/bin`; mise is only needed to install
or update them. Tool, npm and personal-skill installs have separate build stages;
the mise stage caches installed versions and downloads per architecture.

To change bundled packages, edit the manifest, regenerate the derived manifests/registrations with `container/prepare-runtime.mjs` for both image targets, and refresh both npm lockfiles. Commit those changes together, test both variants, then rebuild and recreate the container (`make up`). Replacing the container ends running sessions, so finish active work first.

Rebuilds retain persistent Pi settings, credentials and user-installed packages. Image-managed extension registrations are reconciled at startup; rebuilding does not reset your personal configuration.

## Testing

`npm test` runs the small Docker-free suite for state preservation, replacement guards and runtime-manifest consistency. `npm run test:integration` runs disposable Docker acceptance against prebuilt base, recommended and sandbox images, including Compose persistence, PostgreSQL and Browserless. Phoenix and live sandbox checks are explicitly opt-in.

See [the test guide](../tests/README.md) for image-build commands, suite selection and cleanup behaviour. CI uses the same acceptance runner on AMD64 and ARM64.

## Python language servers

Python files (`.py` and `.pyi`) automatically route to both Ruff and ty through pi-lsp's built-in catalog; no extra configuration is needed. `/lsp` shows command availability. A custom `pi-lsp.json` replaces that catalog, so existing custom configurations must include `{"ty":{"command":["ty","server"],"extensions":[".py",".pyi"]}}` alongside their other servers to enable ty.

## Bundled skills: build details

The personal skills are fetched from `main` on each recommended or sandbox image build, independently of npm and its lockfile. Docker's BuildKit Git `ADD` resolves the branch on each build and reuses the cached contents only when the commit is unchanged. Use `make up` to rebuild and replace the Compose container; restarting an existing container does not update its skills. No startup pulls or runtime GitHub access are needed.

The `pi-calm` repository remains pinned to a full Git commit. Both repositories must be public for credential-free builds. No GitHub token is baked into the image.
