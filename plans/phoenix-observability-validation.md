# Phoenix observability validation

## Artifacts and environment

- Pi: `@earendil-works/pi-coding-agent@1.3.0` (repository runtime pin).
- Exporter: **NikiforovAll/pi-otel**, npm `pi-otel@0.3.0`.
  Tarball integrity: `sha512-DQveOuGYS+S+zKq9irkonDryr8FIdHQ8rYkh513RseyEu6Y+cdCr6ruLkDrVAPuq8ZJghEh48ufnRozijwcTlQ==`.
  Exporter transitive dependencies follow upstream semver ranges; they are not
  bundled or lockfile-pinned by Pi Box.
- Backend: `docker.io/arizephoenix/phoenix:version-20.23.0@sha256:c542e7de1dc1fdd0f938de337d44ebefa7266e91391eed6e7978523d7f6e1f2f`
  (multi-architecture manifest digest; runtime tested on Linux ARM64).
- Host/runtime: Apple Silicon macOS, Docker Desktop 4.94.0 / Engine 29.8.2.
  Runtime fixture used prebuilt base image `pi-box:shared-editors-base-check`
  (`39a4d370f40e`), verifying its Pi version against the repository manifest;
  no Pi image rebuild was needed because image inputs are unchanged.
- Worktree: `pi-box-phoenix`, branch `feat/arize-observability`; the initial
  implementation did not merge or modify unfinished Chromium work. Updated main
  was integrated afterward as recorded below. Disposable runtime testing was
  explicitly approved by the operator.

## Compatibility gate — passed before adding the overlay

A no-network synthetic provider fixture exercised the actual pinned Pi CLI and
published pi-otel extension, using real built-in `read` calls: one successful
read and one missing-file error. No fabricated OTLP, real model calls, operator
`.env`, live volumes, conversations or credentials were used.

After normal CLI exit, Phoenix's REST API returned all **10 spans**:

- Two root **AGENT** spans for two prompts, three `pi.turn` spans, three **LLM**
  spans, and two **TOOL** spans. LLMs/tools are siblings under their turn, which
  is a child of the appropriate agent. `pi.turn` has native kind **UNKNOWN**.
- Each LLM has model `fixture-model`, provider/system `phoenix-fixture`,
  17 prompt / 5 completion / 22 total tokens.
- Prompts and responses are converted to `llm.input_messages.*` and
  `llm.output_messages.*`; assistant tool calls are converted as well. Tool
  parameters and results have native `tool.parameters.*` and `output.value`
  fields. The missing-file tool has status **ERROR** and readable ENOENT output.
- All spans have the same `session.id`; the UI shows **2 traces / 1 session**.

The Phoenix web UI was inspected using isolated headless Chrome via temporary
Playwright tooling (not installed in the repository or Pi image): agent/turn/
LLM/tool tree, prompt, assistant tool calls and arguments, follow-up response,
successful tool output/parameters, and failed-tool output/error badge were
readable in their native panels. Screenshots were visually inspected. This is
not merely an OTLP HTTP-success check. The synthetic workflow is retained in
`tests/fixtures/phoenix/` for repeatability; the disposable UI tooling is not a
production dependency.

## Known limitations

- `pi.cost.usd` survives as an attribute but does not populate native cost totals;
  the synthetic workflow has nonzero cost attributes while the UI reports $0.
- pi-otel emits `cache_write_input_tokens`, not Phoenix's expected
  `cache_creation_input_tokens`; cache-write presentation is not normalized.
- Agent prompt text is in `pi.user_prompt`, not the agent row's native input
  field. LLM messages are readable in native message panels. pi-otel records
  incremental user/tool messages, not a guaranteed complete provider payload or
  system prompt for every request.
- No collector, mapping extension, cost normalization or other telemetry backend
  was added. No real-provider, subagent, AMD64 or Podman runtime claim is made.

## Configuration and operational checks — passed

- `npm test`: **44 passed, 0 failed**, independent of Docker/telemetry packages.
- Real Compose resolution: default Pi-only service and three volumes unchanged;
  Phoenix overlay leaves the entire Pi service unchanged, adds exactly one service
  and one project-scoped volume, and publishes only loopback port 6006. Combined
  PostgreSQL + Phoenix selection resolves, and Pi does not depend on Phoenix.
- Normal `make up` preflight/start succeeds with the overlay and prebuilt Pi image.
  Phoenix healthcheck passes with all capabilities dropped. Running-container
  inspection confirms only `6006/tcp` is published, bound to `127.0.0.1`.
- The explicit pinned `pi install` and settings merge work in disposable agent
  storage, preserving existing settings keys. No image/default package changes.
- Normal CLI exit flushes all 10 spans; `PI_OTEL_DISABLED=1` runs the same workflow
  successfully without adding any spans.
- Force-recreating Phoenix retains the same 10 span IDs in SQLite.
- With Phoenix stopped **before Pi starts**, Pi executes both prompts/tools and
  exits successfully without replay after Phoenix restarts. Measured whole-CLI
  durations: enabled **414ms**, disabled **331ms**, unavailable **325ms**. The test
  allows at most 3 seconds overhead relative to explicitly disabled export.
  A backend that becomes unavailable mid-session was not tested; no claim is
  made about that case or durable replay.
- Biome CLI checks and configured Biome LSP diagnostics pass on all new JS files.
  YAML was validated by real Docker Compose configuration and startup; a YAML LSP
  server is not installed. `git diff --check` passes.
- Successful disposable runs clean up their own containers/network/volumes.
  Earlier harness-only failures (preflight refusing a fixture bind mount, then
  Docker changing its ephemeral port on restart) were fixed and their owned
  resources explicitly removed. Fixtures are now copied into container-local
  test storage after preflight, with no extra Pi mount. No runtime defaults,
  preflight rules, Docker settings or Chromium work were changed.

## Merge preparation against updated main — passed

After Chromium landed, `main` at `a53b3d9` was merged into the Phoenix feature
branch (`4858839`), without changing the main checkout or live configuration.
The original implementation was committed first as `d87e469`.

- Resolved `.env.example` and README conflicts. Preserved main's rewritten README,
  Browserless guide, shared editor defaults and Compose/CI updates. Moved detailed
  Phoenix setup/privacy/shutdown/test instructions to `docs/phoenix.md`, linked
  from the current README; added Phoenix to the architecture diagram.
- `.env.example` retains Pi-only as its sole enabled selection, with commented
  Phoenix examples alone, alongside PostgreSQL, alongside Browserless, and with
  both. No default image/package/settings, existing overlays or lifecycle scripts
  differ from main.
- Expanded the Phoenix runner to resolve all **eight optional-service selections**
  (PostgreSQL/Browserless/Phoenix on or off), checking Phoenix first/last in the
  overlay order. All pre-existing service definitions and volumes remain unchanged
  when Phoenix is added. This is configuration coverage, not a claim that all
  three sidecars were exercised simultaneously.
- Host tests: **45 passed, 0 failed**, including a guide/settings consistency test.
  Biome CLI checks, Biome LSP diagnostics and whitespace checks pass.
- Re-ran the full Phoenix disposable acceptance with prebuilt **recommended**
  image `pi-box:shared-editors-check` (`8499e0c20f5e`), Pi 1.3.0, the same pinned
  pi-otel/Phoenix artifacts, and Docker Desktop ARM64. Native traces, flush,
  explicit disable, SQLite recreation and unavailable-at-start checks passed.
  Whole-CLI timings: enabled **417ms**, disabled **323ms**, unavailable **624ms**.
- Re-ran existing Browserless acceptance with the same recommended image: optional
  and PostgreSQL-combined configuration, health/lifecycle, missing-token rejection,
  DOM action, PNG/PDF output and fresh-session checks passed.
- Both runners exited 0 and removed their owned resources. No model credentials
  or live `.env`/volumes were used. No new full image rebuild, full smoke/Compose/
  PostgreSQL runtime suite, AMD64 run or UI reinspection was performed for this
  reconciliation; the original Phoenix UI inspection remains recorded above.

## Repeatable validation

Fast checks: `npm test` (no Docker/telemetry dependencies). Explicit disposable
runtime checks: `PI_BOX_IMAGE=<prebuilt-pi-image> node tests/phoenix-integration.mjs`.
The runner copies only public Compose/scripts/fixtures into a temporary project,
overrides the Pi container and all three explicitly named Pi volumes, allocates
an unused loopback port, and uses a project-scoped Phoenix volume. It exercises
the real `make up` preflight path without rebuilding the prebuilt image. Successful
runs remove only their own containers, network, volumes and temporary files;
failures retain their uniquely named project and print its directory for manual
inspection/cleanup. It is deliberately not added to the default/Chromium suite.
