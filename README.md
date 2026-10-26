# pi-box

Pi-box is a lightweight development container setup built around the [Pi](https://pi.dev) agent harness.

Dev containers are particularly useful for agentic software engineering because they:

- Limit the damage from agent mistakes or malicious instructions by isolating their tools and filesystem access from the host system.
- When hosted remotely, provides a consistent environment for long-running processes like agent workflows that don't stop when your client connection drops or laptop lid closes.

This repo is a trimmed down version of the setup I am actively using for development - I've published it here both so anyone can use or adopt it, and as a demonstration (in lieu of a blog post) of how I'm working with agents/LLMs these days, and what tools and patterns I've found useful in my own work.

You can run this locally on your laptop, or on a home server/cloud VM and connect remotely over SSH (e.g. via Tailscale).

## Contents

- [Installation and usage](#installation-and-usage)
- [Architecture](#architecture)
- [Included packages and containers](#included-packages-and-containers)
  - [Packages and sidecars](#packages-and-sidecars)
  - [What about skills?](#what-about-skills)
- [Advanced setup and technical details](#advanced-setup-and-technical-details)
  - [Base image](#base-image)
  - [Git setup](#git-setup)
  - [Web development and browser access](#web-development-and-browser-access)
  - [Optional services: PostgreSQL](#optional-services-postgresql)
  - [Optional services: Browserless Chromium](#optional-services-browserless-chromium)
  - [Optional services: Phoenix tracing](#optional-services-phoenix-tracing)
  - [Multiple Pi-box instances](#multiple-pi-box-instances)
  - [Running in a virtual machine](#running-in-a-virtual-machine)
  - [Tailscale](#tailscale)
  - [Updating extensions](#updating-extensions)

## Installation and usage

Prerequisites for the existing Compose workflow: Docker with Compose v5.0 or newer.

With Docker running, run:

```bash
git clone https://github.com/seitaro-white/pi-box.git
cd pi-box
docker compose up -d --build
```

Attach to the container's tmux session and start Pi:

```bash
docker compose exec pi-box tmux attach-session -t '=shell'
pi
```

There are also convenience targets in `Makefile`. The workspace, Pi settings, Git credentials and Herdr state are stored in persistent volumes and survive image rebuilds and container replacement


## Architecture

Pi-box includes a main dev container that contains Pi and basic dev tools, with optional PostgreSQL, Browserless Chromium and Phoenix tracing sidecars. These are managed with Docker Compose.


```mermaid
flowchart TD
    subgraph compose["Containers managed by Docker Compose"]
        pi["Pi Box: tmux, Pi, extensions and dev tools"]
        db["Optional PostgreSQL container"]
        browser["Optional Browserless Chromium container"]
        phoenix["Optional Phoenix trace viewer"]
        pi -. "postgres:5432" .-> db
        pi -. "CDP: browser:3000" .-> browser
        pi -. "OTLP HTTP: phoenix:6006" .-> phoenix
    end

    subgraph volumes["Persistent volumes"]
        workspace["Workspace: /workspace"]
        agent["Pi state: /home/node/.pi/agent"]
        git["Git: /home/node/.config/git"]
        herdr["Herdr: /home/node/.herdr"]
        data["Optional PostgreSQL data"]
        traces["Optional Phoenix SQLite traces"]
    end

    pi --> workspace
    pi --> agent
    pi --> git
    pi --> herdr
    db --> data
    phoenix --> traces

    classDef core fill:#dbeafe,stroke:#2563eb,color:#172554
    classDef optional fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-dasharray:5 5
    class pi,workspace,agent,git,herdr core
    class db,data,browser,phoenix,traces optional
```


The development container runs as the non-root `node` user, with Linux capabilities dropped and no host home directory or Docker socket mounted. This reduces privileges, but is **not a complete agent sandbox**: Pi can still modify or delete mounted files and use outbound network access to leak credentials available inside the container. Isolation does not prevent prompt injection; it limits what an agent following malicious instructions can reach.

## Included packages and containers

### Packages and sidecars

The default image includes:

- **Pi** — coding agent harness - model agnostic, minimal and easily extendable. Pi is great and you should check it out regardless of whether you use this container
- **tmux** - terminal multiplexer, for managing multiple terminal sessions/long-running processes.
- **[Herdr](https://herdr.dev/)** (recommended image) — optional agent session manager, with its official `herdr` skill exposed to Pi. See [Pi-box setup and storage](docs/herdr.md).
- **[Hunk](https://hunk.dev/)** (recommended image) — interactive terminal diff reviewer, with its `hunk-review` skill exposed to Pi. See [Hunk](https://github.com/modem-dev/hunk).
- **Standard development tools:** Bash, Git, curl, ripgrep, fd (`fdfind` on Debian).
- **TUI navigation tools:** micro (file editor), bat (`batcat` on Debian, file pager), nnn (file explorer). Used in combination these allow for a very basic terminal-based development experience, very handy if ssh'ing in from a client system that lacks an IDE.

- **Python, uv and Ruff**
- **Node.js, npm and Biome**
- **PostgreSQL client (`psql`)**


- **Pi Extensions**
    - **`pi-subagents`** — spin up and delegate to subagents for parallel agent workflows.
    - **`pi-web-access`** — simple web access/search - useful to have this as a capability separate from any given model provider.
    - **`@narumitw/pi-lsp`** — Gives Pi access to the Ruff & Biome toolchain - you can catch a surprising number of issues in AI-generated code with good old-fashioned linting before you even get to agent reviews.
    - **`@narumitw/pi-usage`** — Usage dashboard for subscription based coding plans.
    - **`@juicesharp/rpiv-ask-user-question`** — structured questions with selectable answers.
    - **`@juicesharp/rpiv-todo`** — task tracking for multi-step work.
    - **[`pi-calm`](https://github.com/JesseZhang97/pi-calm)** — quieter tool output; toggle with `/calm`.
    - **`pi-stretchtext`** — expandable inline explanations that keep replies concise until you open the details.
    - **Herdr's official Pi integration** — Installed by `herdr integration install pi` at container startup; reports status and session identity, inactive outside Herdr.

- **Sidecars**
    - **PostgreSQL Server** - Optional local database server intended for development/testing, not production.
    - **Browserless Chromium** - Optional headless browser accessed over CDP; trusted development only, with SSPL/commercial licensing and Chromium's sandbox disabled upstream.
    - **Arize Phoenix** - Optional local trace viewer with SQLite storage. Requires explicit installation/configuration of `pi-otel`; full-content traces can retain private data and secrets.

### What about skills?

The recommended image bundles my [personal development skills](https://github.com/seitaro-white/personal-agent-skills) as a Pi package, including planning, review and cleanup workflows. Skills are project- and team-specific: treat these as starting points to adapt, not universal rules. It also includes the tool-specific `herdr` and `hunk-review` skills, which teach Pi how to control Herdr panes and interact with live Hunk review sessions.

The personal skills and `pi-calm` repositories are pinned to full Git commits and installed into the image alongside npm packages. These repositories must be public for credential-free builds; running a prebuilt image does not require GitHub access. No GitHub token is baked into the image.



## Advanced setup and technical details

### Base image

The default build target is `recommended`. A stripped-down `base` target includes Pi and the shared development tools, but omits Herdr, Hunk (including its skill), the bundled Pi extensions, Ruff and Biome. To select it, set these overrides in your local `.env` before building:

```dotenv
TARGET=base
IMAGE=pi-box:0.2.0-base
```

Both Compose variants include `/AGENTS.md` and a `pi-box` skill with environment
and service instructions. Replacing the image updates these without changing
personal Pi settings; use `/reload` in existing Pi sessions. uv Python/tool
installs persist in the agent volume.

### Git setup

Configure your Git identity inside the container and clone projects into `/workspace`. Git settings and HTTPS credentials persist in the Git volume; host Git configuration and SSH keys are not mounted automatically.

For private repositories, use a narrowly scoped token. The credential helper
stores it as plaintext in `/home/node/.config/git/credentials`, readable by Pi.

### Docker Sandboxes

An optional mountless micro-VM deployment for Apple Silicon Macs uses native
`sbx env` commands and [`sbxenv.yaml`](sbxenv.yaml). See the
[sandbox guide](docs/sandboxes.md) for setup, login and storage options.
Internal storage survives stop/start, but not sandbox deletion.

### Web development and browser access

Compose publishes port **5173** at **http://localhost:5173** on the Docker host's
loopback interface. Bind your app to **`0.0.0.0:5173`** inside Pi.

For Vite, set the project's dev script:

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173 --strictPort"
  }
}
```

Run `npm run dev`. Pi's optional Browserless browser visits
**`http://pi-box:5173`**; your host browser needs no sidecar.

Set `DEV_PORT=15173` in `.env` and run `make up` to change the host port.
The app and Browserless still use port 5173 internally. Applying changes can
recreate Pi and end active sessions.

For remote viewing, run on your client machine:

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:5173:127.0.0.1:5173 your-mac-ssh-alias
```

Keep the tunnel open and visit `http://localhost:5173`. For a custom `DEV_PORT`,
change the destination port; change the first port if the client port is occupied.

### Optional services: PostgreSQL

Optional services are added through Compose overlays. PostgreSQL is included as an example; select it in your private `.env`:

```dotenv
COMPOSE_FILE=compose.yaml:compose.postgres.yaml
POSTGRES_PASSWORD='your-private-password'
```

Run `make up` to build and start the selected services. Pi connects to `postgres:5432` using the supplied `PG*` environment variables; no database port is published to the host. It has database administrator access, so keep this separate from production data. PostgreSQL has its own persistent volume; changing `.env` does not rotate an existing database password.

Combine overlays by appending their filenames to `COMPOSE_FILE`. Stop a sidecar
before removing its overlay; deselecting it alone leaves the container running.

### Optional services: Browserless Chromium

Select the browser overlay in your private `.env`:

```dotenv
COMPOSE_FILE=compose.yaml:compose.browserless.yaml
BROWSER_TOKEN='your-own-strong-private-token'
```

Run `chmod 600 .env` and `make up`. Pi receives `BROWSER_CDP_URL` and
`BROWSER_TOKEN`. See the [Browserless guide](docs/browserless.md) for a client
example and licensing/security details.

### Optional services: Phoenix tracing

Select Phoenix in your private `.env`:

```dotenv
COMPOSE_FILE=compose.yaml:compose.phoenix.yaml
```

Run `make up`, then follow the [Phoenix guide](docs/phoenix.md) to install and
configure `pi-otel`. The UI is at `http://localhost:6006`; traces persist in SQLite.
**Full-content traces can retain prompts, code, tool results and secrets.**

### Tailscale

Tailscale can provide private access to the Docker host or VM. Run it on the host and client, SSH to the host over your tailnet, then run `docker compose exec -it pi-box bash -l` from the repository directory and manage sessions yourself.

The host must remain awake and online.

### Updating extensions

Bundled Pi and extension versions are pinned in [`container/package.json`](container/package.json); Ruff is pinned separately in the `Dockerfile`. `make versions` checks the npm pins against registry versions without changing anything, and labels Git commit pins without checking upstream. Update Git packages by replacing their full commit hashes in the manifest.

To change bundled packages, edit the manifest, regenerate the derived manifests/registrations with `container/prepare-runtime.mjs` for both image targets, and refresh both npm lockfiles. Commit those changes together, test both variants, then rebuild and recreate the container (`make up`). Replacing the container ends running sessions, so finish active work first.

Rebuilds retain persistent Pi settings, credentials and user-installed packages. Image-managed extension registrations are reconciled at startup; rebuilding does not reset your personal configuration.

## Testing

`npm test` runs the small Docker-free suite for state preservation, replacement guards and runtime-manifest consistency. `npm run test:integration` runs disposable Docker acceptance against prebuilt base, recommended and sandbox images, including Compose persistence, PostgreSQL and Browserless. Phoenix and live sandbox checks are explicitly opt-in.

See [the test guide](tests/README.md) for image-build commands, suite selection and cleanup behaviour. CI uses the same acceptance runner on AMD64 and ARM64.
