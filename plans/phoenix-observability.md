# Optional Phoenix + pi-otel observability

Status: implemented and validated in the isolated worktree; the compatibility gate passed before repository integration. Disposable runtime tests were separately approved. This replaces the Langfuse proposal. Exact tested artifacts, outcomes and limitations are recorded in [validation notes](phoenix-observability-validation.md).

## Minimal scope

- At the operator's implementation request, work only in the fresh `/Users/josephwhite/gitrepos/pi-box-phoenix` worktree, branch `feat/arize-observability`, based on `feat/langfuse-observability`. The original implementation did not modify the separate Chromium checkout or merge its unfinished work. After Chromium landed, updated main was merged into this feature branch for integration preparation; see the validation notes.
- One optional `compose.phoenix.yaml` overlay adds **one Phoenix container**, using SQLite in a project-scoped named volume. No PostgreSQL dependency, collector, proxy, Redis or other backend.
- Pi exports traces directly through **NikiforovAll/pi-otel** (`pi-otel` on npm), not the unrelated jcpowermac project.
- Default Pi-only Compose, images, installed packages, settings and lifecycle behavior remain unchanged. No automatic installation into the persistent agent directory; no global OTEL environment defaults.
- Full-content traces for error analysis: prompts, responses and tool arguments/results must be readable in Phoenix. Metrics, logs and shell propagation stay off. No Makefile/orchestration changes unless a demonstrated blocker requires a separate review.

## Original compatibility research (subsequently runtime-verified)

Research inspected pi-otel commit `bf00f530d3667375a5317a0f425d0918e6cfac7e` and Phoenix main commit `c9a3087027fedff23c32b083534d0a16bcce1a25`. These are source references, **not selected release/image pins**. Before integration, select an immutable Phoenix image and published pi-otel version containing the needed behavior, then test those exact artifacts against this repository's pinned Pi.

Phoenix does not merely store arbitrary OTLP spans: its OTLP decoder calls `get_openinference_attributes` to synthesize OpenInference fields from `gen_ai.*`. Existing explicit OpenInference attributes take precedence. Source comparison shows:

| pi-otel emission | Phoenix interpretation in inspected source |
| --- | --- |
| `spanNaming: "genai"` sets operations `invoke_agent`, `chat`, `execute_tool` | AGENT, LLM, TOOL kinds respectively; renaming spans alone is not the mechanism |
| `gen_ai.request.model`, `gen_ai.provider.name` | LLM model/provider fields; use genai mode rather than relying on legacy `gen_ai.system="pi"` |
| `gen_ai.usage.input_tokens`, `output_tokens` | Prompt/completion counts and their sum |
| `gen_ai.conversation.id` | `session.id`; verify grouping across turns in the selected release |
| JSON `gen_ai.input.messages` / `output.messages`, using `role` and `parts` | Parsed into LLM message fields, including text/tool calls; metadata-only deliberately omits content |
| `gen_ai.tool.name`, `tool.call.id`, `tool.call.arguments`, `tool.call.result` | Tool identity/parameters/output when present; full capture is required for arguments/results |
| `pi.cost.usd` | No mapping in the inspected GenAI converter; do not promise native Phoenix cost totals from this field |
| Cache usage | Phoenix reads `cache_read_input_tokens` and `cache_creation_input_tokens`; pi-otel can emit `cache_write_input_tokens` from Pi's `cacheWrite`, which is not mapped here |

**Decision gate:** direct ingestion is plausible from source inspection, but HTTP success is insufficient. Verify native kinds, model/token fields, hierarchy and readable prompts/responses/tool content in the selected Phoenix release before implementing the repository integration. Record session-grouping behavior without making it an MVP blocker. If essential fields fail, report the mismatch and pause; do not silently add a collector, custom mapping extension or alternative instrumentation. Cost/cache-write presentation gaps may be documented limitations, not reasons to expand v1.

## Proposed setup after the gate passes

1. Add only `compose.phoenix.yaml`, commented opt-in examples and concise documentation, plus focused validation if needed. Select with `COMPOSE_FILE=compose.yaml:compose.phoenix.yaml`; also check composition with `compose.postgres.yaml`. Current service name is `pi-box`.
2. Phoenix uses `PHOENIX_WORKING_DIR=/mnt/data`, with its own named volume mounted there; leave external SQL configuration unset so it uses SQLite. Pin a tested image version/digest. Publish only `127.0.0.1:${PHOENIX_UI_PORT:-6006}:6006`; do not publish gRPC or metrics ports. No Pi data mounts, Docker socket or provider credentials in Phoenix.
3. Explicitly install the verified pinned pi-otel release only in an opted-in agent environment. Preserve existing settings. Configure that environment (illustrative settings below), rather than altering image defaults. Do not run `/otel start`: it launches a different backend.

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

pi-otel expects an HTTP **base** endpoint and appends `/v1/traces`; do not configure that suffix twice. `phoenix` is Compose DNS for Pi; a host browser uses `http://localhost:6006`. No keys are needed for the proposed trusted-local, unauthenticated deployment. Loopback binding is not authentication: other containers on the shared network can reach Phoenix. Remote access uses SSH forwarding, not a public port.

pi-otel defaults to enabled once installed; removing the overlay does not uninstall or disable it. Document `PI_OTEL_DISABLED=1` or `otel.enabled=false`, and stop the Phoenix service before deselecting its overlay. Retain the SQLite volume on ordinary shutdown; deletion is explicit and destructive. No Pi `depends_on` on Phoenix. Check that an unavailable Phoenix does not noticeably disrupt Pi work or exit; do not promise durable replay.

Full-content capture is an explicit opt-in for error analysis. It can retain prompts, responses, source code, private data, tool arguments/results and secrets. Never validate with real conversations or credentials. SQLite data persists and can grow; no automated retention is promised.

## Essential validation — before calling v1 integrated

After separate approval to run disposable tests:

- [x] **Compatibility gate first:** record exact image/package/Pi versions. Run one synthetic workflow using actual pi-otel output, using the smallest available test mechanism; build a local provider fixture only if necessary. Query stored spans and inspect the UI: agent/LLM/tool kinds and hierarchy, model/provider, known token counts, a tool error, readable prompts/responses and tool arguments/results, and export on normal exit. Record session-grouping behavior and cost/cache limitations; no normalization work.
- [x] **Configuration regression:** default Pi-only selection is unchanged and needs no Phoenix variables or package. Phoenix overlay adds one service/one SQLite volume, loopback UI only; optional development PostgreSQL still composes. Keep fast `npm test` independent of Docker and telemetry dependencies.
- [x] **Operational minimum:** in isolated resources, prove SQLite traces survive Phoenix recreation; explicitly disabled pi-otel exports nothing; Pi still works and exits without noticeable disruption when Phoenix is unavailable. Rely on existing agent-volume persistence for installed settings/packages; do not change `make replace` scope.

Use a unique Compose project **and override this repository's explicit Pi container and workspace/agent/Git volume names**, plus a distinct loopback port. Never copy operator `.env`, use live volumes, change Docker Desktop settings or globally prune resources. Worktrees do not isolate Docker resources. Report the environment actually tested; do not imply broader runtime coverage.

## Later, only if needed

Anything beyond local full-content trace viewing requires demonstrated need, not speculative implementation. No cost normalization, subagent correlation, architecture matrix, backup/retention tooling or extra telemetry backends in MVP. Chromium has since landed in main; its composition with Phoenix was reconciled and validated during merge preparation, without changing the Browserless overlay.

## Sources

- [Phoenix Docker and SQLite deployment](https://arize.com/docs/phoenix/self-hosting/deployment-options/docker): working directory, persistence, UI/OTLP HTTP port 6006.
- [pi-otel README](https://github.com/NikiforovAll/pi-otel/blob/bf00f530d3667375a5317a0f425d0918e6cfac7e/README.md), [attribute definitions](https://github.com/NikiforovAll/pi-otel/blob/bf00f530d3667375a5317a0f425d0918e6cfac7e/src/attrs.ts), [span/message emission](https://github.com/NikiforovAll/pi-otel/blob/bf00f530d3667375a5317a0f425d0918e6cfac7e/src/spans.ts), [configuration](https://github.com/NikiforovAll/pi-otel/blob/bf00f530d3667375a5317a0f425d0918e6cfac7e/src/config.ts).
- [Phoenix OTLP decode path](https://github.com/Arize-ai/phoenix/blob/c9a3087027fedff23c32b083534d0a16bcce1a25/src/phoenix/trace/otel.py), [GenAI → OpenInference conversion](https://github.com/Arize-ai/phoenix/blob/c9a3087027fedff23c32b083534d0a16bcce1a25/src/phoenix/trace/gen_ai/conversion.py).
