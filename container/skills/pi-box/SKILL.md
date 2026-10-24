---
name: pi-box
description: >-
  Operate inside the Pi-box development environment: filesystem layout,
  persistence, tool installation, optional sidecar connections, and
  host/container boundaries. Use when troubleshooting the environment,
  installing tools, connecting to services, or determining what survives
  a restart or replacement.
---

# Pi-box environment guide

## Establish the current environment

Pi-box normally runs as the non-root `node` user, with home directory
`/home/node` and projects under `/workspace`.

There are multiple deployment modes and image variants. Treat this guide
as the default architecture, not proof of the current configuration.

Before environment-specific work:
- Check the current directory, user, and relevant installed tools.
- Check only the environment variables needed for the task.
- Distinguish a missing client, missing configuration, and unreachable
  service before recommending changes.
- Do not dump the environment, credential files, or connection URLs:
  they may contain secrets.

The recommended image includes more tools and integrations than the base
image. Optional sidecars are not necessarily enabled.

## Filesystem and persistence

For the default Docker Compose deployment:

| Location | Purpose | Survives container replacement? |
|---|---|---|
| `/workspace` | Projects and working files | Yes, in the workspace volume |
| `/home/node/.pi/agent` | Pi state, settings and user packages | Yes, in the agent volume |
| `/home/node/.config/git` | Git settings and HTTPS credentials | Yes, in the Git volume |
| `/home/node/.herdr` | Herdr state | Yes, in the Herdr volume |
| Other container paths | Image files and temporary/local changes | Do not assume so |

Persistence is not a backup. Deleting files in a mounted volume deletes
the persistent copies too.

The optional Docker Sandbox deployment has different storage semantics:
its default internal storage survives stop/start, but not sandbox deletion.
Shared host-directory storage is an opt-in alternative. Confirm the
deployment and mounts before promising that data will survive.

Do not assume the Pi-box source repository or its documentation is
available inside the running container.

## Host and container boundaries

The default Compose container:
- Runs without root privileges and with Linux capabilities dropped.
- Does not mount the host home directory or Docker socket.
- Can access mounted files and make outbound network requests.
- Can therefore still damage project data or expose accessible secrets.

Do not assume `sudo`, Docker access, host paths, or host administration
are available. Do not try to bypass isolation to complete a task.

Building images, changing Compose overlays, publishing ports, and
recreating containers are normally host-side operations. When needed,
explain the required host action and give the user commands with an
explicit working-directory requirement.

Do not recommend container replacement without warning that it ends
running sessions. Destructive volume operations require explicit approval.

## Connecting to optional services

Inside Compose, use service DNS names—not `localhost`.

Configuration being present does not prove a service is running.
Check availability with a bounded connection attempt. Report failures
without exposing credentials.

### PostgreSQL

- Default service address: `postgres:5432`.
- Use the supplied `PG*` environment variables with `psql` or a client.
- Do not print `PGPASSWORD` or embed credentials in command arguments.
- No database port is published to the host by default.
- The development account has database administrator privileges.

Keep this separate from production data. Get approval before destructive
database operations.

PostgreSQL data lives in its own persistent volume. Changing the configured
password does not rotate the password of an existing database.

### Browserless Chromium

- Default service address: `browser:3000`.
- Use `BROWSER_CDP_URL` and `BROWSER_TOKEN` as configured.
- Treat the connection URL as a secret: it may contain the token.
- Install any browser client needed by the project in that project.
- Close browser sessions and connections when finished.

The default service has no persistent storage and publishes no host port.
It is intended for trusted development; upstream disables Chromium's
sandbox. Do not treat it as a safe environment for hostile content.

### Phoenix tracing

- Default internal service address: `phoenix:6006`.
- Starting Phoenix does not automatically enable Pi tracing.
- Exporter installation and configuration are separate, explicit steps.
- Do not enable full-content capture without user approval: traces can
  retain prompts, code, tool results, and secrets.

The Compose UI is exposed on the Docker host's loopback interface by
default. A user's browser needs the host-side address or an SSH tunnel,
not the internal Compose hostname.
