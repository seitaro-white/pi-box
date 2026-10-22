# Phoenix — local trace viewer

[Arize Phoenix](https://arize.com/docs/phoenix) makes Pi sessions easier to inspect:
model calls, prompts/responses, tool calls/results, timing and token usage.
The optional [`compose.phoenix.yaml`](../compose.phoenix.yaml) runs it as a local
sidecar; [pi-otel](https://github.com/NikiforovAll/pi-otel) sends Pi traces to it
via OpenTelemetry (OTLP). No API keys, PostgreSQL or separate collector required.

## Start Phoenix

In the host repository's `.env`, add the Phoenix overlay:

```dotenv
COMPOSE_FILE=compose.yaml:compose.phoenix.yaml
# Optional: PHOENIX_UI_PORT=6006
```

If you already use other overlays, append `:compose.phoenix.yaml` to your existing
`COMPOSE_FILE` instead. Then run:

```bash
make up
make attach
```

## Send Pi traces

**Inside Pi Box**, merge this `otel` object into `~/.pi/agent/settings.json`,
keeping your existing settings:

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

Install the exporter and start a new Pi session:

```bash
pi install npm:pi-otel@0.3.0
pi
```

Both image variants support this setup. Settings and installation persist in the
agent volume. Restart any already-running Pi processes to pick up the changes.
Do **not** use `/otel start`; it launches a different backend.

## View traces

Open **http://localhost:6006** on the host and select the `default` project.
Use your overridden `PHOENIX_UI_PORT` if set. Run a conversation and tool call in
Pi; exit Pi normally to flush pending spans, then allow a few seconds for ingestion.

Phoenix stores its own copy of traces in a persistent SQLite volume (normally
`pi-box_phoenix`). Its UI is bound to localhost. Metrics, logs and shell propagation
are off with the configuration above.

If traces are missing:

- Check the backend with `docker compose logs phoenix`.
- Start Phoenix **before** starting Pi. If the backend was unavailable at session
  start, restart Pi after it becomes available.
- Check for conflicting project `otel` settings or `OTEL_*` / `PI_OTEL_*`
  environment overrides.
- Keep the exporter endpoint as `http://phoenix:6006`: `phoenix` is the container
  hostname, and pi-otel adds `/v1/traces` automatically.

## Turn it off

Set `otel.enabled` to `false` in the agent settings and restart Pi. Then, from the
host, run `docker compose stop phoenix` before removing `:compose.phoenix.yaml`
from `.env`. Stopping Phoenix keeps its stored traces; removing the overlay alone
does not disable the Pi exporter.

## Further details

Phoenix displays agent/LLM/tool spans and token usage, but its native cost totals
are not populated by this setup. For compatibility details and acceptance-test
results, see the [validation notes](../plans/phoenix-observability-validation.md).
