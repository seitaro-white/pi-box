# Optional Phoenix — local full-content traces

[Arize Phoenix](https://arize.com/docs/phoenix) provides local trace viewing via
[`compose.phoenix.yaml`](../compose.phoenix.yaml). It adds one digest-pinned Phoenix
20.23.0 container and a project-scoped SQLite volume, normally `pi-box_phoenix`.
It needs no PostgreSQL, collector, API keys or provider credentials. Pi's images,
packages and default settings are unchanged; enabling the backend alone does
**not** enable tracing.

**Full-content capture is an explicit privacy-sensitive opt-in.** Traces can
retain prompts, responses, source code, private data, tool arguments/results and
secrets. Only enable it for data you are willing to store. SQLite persists and
can grow; there is no automatic retention, backup or secret redaction guarantee.
Use synthetic conversations for testing.

## Enable the backend and exporter

1. In the host repository's private `.env`, select:

   ```dotenv
   COMPOSE_FILE=compose.yaml:compose.phoenix.yaml
   # Optional host-only port override:
   # PHOENIX_UI_PORT=6006
   ```

   Phoenix also composes with PostgreSQL and Browserless Chromium. Append
   `:compose.phoenix.yaml` to your existing selection; for all optional services:

   ```dotenv
   COMPOSE_FILE=compose.yaml:compose.postgres.yaml:compose.browserless.yaml:compose.phoenix.yaml
   ```

   Keep the existing private `POSTGRES_PASSWORD` and `BROWSER_TOKEN` when their
   overlays are selected. Phoenix needs neither credential. Finish active work
   before `make up`, which can recreate Pi Box if its image/configuration changed.
   Run `make up`, then `make attach`.

2. **Inside Pi Box**, before starting a new Pi session, merge this `otel` object
   into `~/.pi/agent/settings.json`. Keep all existing keys, especially `packages`;
   do not replace the entire file. Both image variants support this setup.

   ```json
   {
     "otel": {
       "enabled": true,
       "endpoint": "http://phoenix:6006",
       "protocol": "http/protobuf",
       "serviceName": "pi",
       "spanNaming": "genai",
       "captureContent": "full",
       "propagateToShell": false,
       "signals": { "traces": true, "metrics": false, "logs": false }
     }
   }
   ```

   Review and explicitly install the verified package from
   [NikiforovAll/pi-otel](https://github.com/NikiforovAll/pi-otel):

   ```bash
   pi install npm:pi-otel@0.3.0
   pi
   ```

   Installation/settings persist in the agent volume. Existing running Pi
   processes need to exit and restart. Do **not** run `/otel start`: that command
   launches a different backend. The HTTP endpoint is a **base URL**; pi-otel adds
   `/v1/traces`. `phoenix` is Compose DNS, not the host browser address. Project
   `otel` settings and `OTEL_*`/`PI_OTEL_*` environment overrides can take precedence;
   remove conflicting overrides if traces are missing.

3. Open **http://localhost:6006** on the host (or your overridden UI port), choose
   the `default` project and inspect traces. Normal Pi exit flushes pending spans;
   ingestion may take a few seconds. `docker compose logs phoenix` shows backend
   logs. Metrics, logs and shell propagation remain off with the settings above.

The UI/OTLP HTTP port is bound to `127.0.0.1`, with no published gRPC or metrics
ports. This is a trusted-local, **unauthenticated** deployment: loopback binding
is not authentication, and other containers on the shared network can access
Phoenix. No Pi data mounts, Docker socket or provider credentials are passed to
Phoenix. For remote viewing, forward the port through SSH rather than exposing it:

```bash
ssh -N -L 6006:127.0.0.1:6006 YOUR_HOST_USERNAME@YOUR_HOST_ADDRESS
```

## Disable and manage stored data

pi-otel defaults to enabled once installed. Removing the overlay does **not**
uninstall or disable the exporter. Set `otel.enabled` to `false` in the agent
settings and restart Pi, or use `PI_OTEL_DISABLED=1 pi` **inside Pi Box** for a
single run. Merely setting that variable in the host `.env` does not pass it into
Pi. To uninstall explicitly, use `pi remove npm:pi-otel@0.3.0`.

While the Phoenix overlay is still selected, run:

```bash
# From the host repository:
docker compose stop phoenix
```

Then remove `:compose.phoenix.yaml` from `.env`. Ordinary shutdown/recreation
retains SQLite data, and `make replace` still replaces **Pi only**. Pi has no
startup dependency on Phoenix; an unavailable backend should not block work.
There is no durable trace replay guarantee; with this pi-otel release an endpoint
unreachable at session start disables export for that session. Restart Pi after
Phoenix becomes available.

To **irreversibly delete traces**, stop/remove only the Phoenix container with
`docker compose rm -s -f phoenix` (while its overlay is selected), then remove
only its volume: `docker volume rm pi-box_phoenix`. Substitute your actual
project-scoped volume name if customized. Never use `down -v` to clear traces:
it also deletes Pi workspace/agent/Git and any PostgreSQL volumes. Independent
instances need different project names, Pi container/volume overrides, and UI
ports; a worktree alone does not isolate Docker resources.

## Verified behavior and limitations

Pi 1.3.0 + pi-otel 0.3.0 + the pinned Phoenix image were tested with synthetic
model output and real Pi tool execution on Docker Desktop ARM64. Phoenix shows
native AGENT/LLM/TOOL kinds, agent → `pi.turn` → LLM/tool hierarchy, model/provider,
prompt/completion token counts, readable prompts/responses, tool parameters/results
and failed tools. Two prompts in one Pi session group into one Phoenix session.
`pi.turn` itself appears as UNKNOWN; agent prompts are available in the
`pi.user_prompt` attribute, while LLM prompts/responses appear in the message UI.
pi-otel captures incremental user/tool messages, not necessarily the entire
provider payload or system prompt on every LLM span.

`pi.cost.usd` is preserved as an attribute, not converted into native Phoenix cost
totals (a displayed $0 is not a reliable spend estimate). Cache-write tokens are
not mapped from pi-otel's `cache_write_input_tokens` field. No normalization,
subagent correlation or broader runtime/architecture coverage is promised.
See [validation notes](../plans/phoenix-observability-validation.md).

## Acceptance tests

Fast checks: `npm test` (Node.js only, no Docker or telemetry dependencies).
Phoenix acceptance is a separate explicit opt-in, not part of the default or
Chromium integration suite. With a prebuilt Pi image:

```bash
PI_BOX_IMAGE=pi-box:0.2.0 node tests/phoenix-integration.mjs
```

The runner pulls the pinned backend and installs `pi-otel@0.3.0` only into
disposable agent storage. It checks every combination of the optional Compose
overlays, stored native trace fields, normal-exit flushing, explicit disable,
SQLite recreation, and an unreachable backend at session start. It uses synthetic
model output and real Pi tool calls; no model credentials are needed. Successful
runs clean up only their own resources; failures retain an isolated project and
print its name/directory for inspection. Web UI inspection was performed
separately, as recorded in the validation notes.
