# Issue #17: fresh, mountless Docker Sandboxes deployment

## Decisions

- Initial host: Apple Silicon Mac. Clients SSH to the hosting machine; clients do not need model credentials.
- Repositories are cloned inside a named, persistent, mountless sandbox. No host home/project directory or host Docker socket is shared.
- **Codex authentication: use Pi `/login` inside the sandbox.** Host-side model OAuth proxy integration is explicitly out of scope. Real access/refresh tokens will therefore be readable by the sandbox user and generated commands; micro-VM isolation does not prevent their disclosure.
- GitHub authentication: prefer a host-side secret resolver (`sbx secret set github --command 'gh auth token'`) and proxy wiring for Git HTTPS/GitHub API access. Verify the kit's required credential declarations and actual Git clone/push behaviour. Do not mount host Git credentials or SSH private keys; disable SSH-agent forwarding unless explicitly requested.
- Preserve the current development tools and pinned Pi/extensions, updating versions only deliberately if required for compatibility.
- No existing volume contents/history need migration. User has pushed repositories. Do not wipe anything until the replacement is validated and exact resources are identified.
- Optional host mounts and PostgreSQL/Browserless/Phoenix integration are deferred.
- Sessions are managed by the user: no sandbox launcher or custom tmux config, and no Make attach targets for either runtime. Register extensions at image build time; keep tmux installed as an optional tool.
- Outbound networking is allow-all by user choice. Existing balanced baseline was broadened with a global `sbx policy allow network '**'` TCP rule, avoiding a reset of filesystem/other policies. Removed the project allowlist and now-unnecessary access mixin. Explicit denies and runtime UDP/ICMP limitations still apply.

## Networking simplification (2026-10-22)

- Applied approved global catch-all TCP rule without resetting policies, filesystem settings, or credential state. Verified existing pi-box policy allows previously unlisted example.com:443 and example.net:8443.
- Removed the network capability from pi-box.yaml and the generated access mixin. Fresh mountless creation now needs only the compiled image plus built-in shell identity.
- Fresh disposable sandbox passed outbound HTTPS, private Git read using the host proxy, and runtime smoke tests. All 53 host tests and kit validation/build pass. Existing pi-box was not recreated.

## Session-management simplification (2026-10-22)

- Removed sandbox launch.sh and tmux.conf and both Make attach targets. `make sandbox-shell` is a plain `sbx exec -it NAME bash -l`; direct aliases/commands do not depend on Make.
- Extension defaults/registrations are seeded under USER agent during image build. Login shells retain private umask defaults, without runtime startup wrappers.
- Validated a freshly built disposable sandbox: 4 extension registrations already exist, no auto-created tmux sessions/config or launcher, manual tmux works, and runtime/persistence smoke checks pass. All 53 host tests pass.
- Existing `pi-box` was not recreated or modified: it may contain user login/work since initial setup. These image changes apply on fresh creation; old Docker volumes remain untouched.

## Initial implementation checkpoint (2026-10-22)

- Implemented opt-in kit/image, secret-free staging, guarded `make sandbox-*` commands, documentation, 7 new host tests, opt-in runtime smoke tests, and container-only sandbox-image CI checks.
- User installed/logged into sbx v0.49.2 and explicitly selected balanced global networking. Disabled SSH-agent forwarding and registered the existing host `gh auth token` resolver for GitHub.
- Found and worked around a v0.49.2 limitation: custom v3 agent names are rejected at creation. Build the v3 image, then create the built-in shell identity with that image and an access-only v2 network mixin. Shell already provides the GitHub credential service; redeclaration conflicts.
- `pi-box` is running detached, mountless, with 4 CPUs/4 GiB and shared skills disabled. Source tools/pins are preserved. A public clone is at `/home/agent/workspace/pi-box`.
- Verified: all 52 host tests pass; v3 kit validation/build passes; installed runtime tools and 4 extension registrations; no usable forwarded SSH socket or host Docker socket; GitHub API HTTP 200; private HTTPS Git read; workspace persistence across stop/start; initializer leaves auth state unchanged.
- Old Docker volumes have NOT been removed. Disposable probe sandbox was removed. The running initial sandbox predates only a descriptor cleanup removing an unused GitHub declaration; its runtime Dockerfile/config is current.
- Pending acceptance: user's Codex `/login`, actual model/extension/LSP workflow, OAuth refresh, SSH disconnect/reconnect, approved Git write, resource measurement, and remote CI (including AMD64 image smoke). Do not treat these as passed or delete old storage yet.
- Changes are on the branch and uncommitted. See `docs/sandboxes.md` for commands and limitations.

## Original pre-implementation state

- Branch: `issue-17-docker-sandboxes`.
- Existing Compose deployment uses named workspace, agent, and Git volumes; it does not share the Mac home directory.
- `Dockerfile` builds non-root base/recommended images, with pinned packages in `container/package.json` and lockfiles, runtime initialization, and tmux.
- `Makefile` currently manages Docker Compose lifecycle. Existing tests exercise that architecture.
- `sbx` is not installed in this development shell. The local Docker daemon was unreachable during the earlier inspection. No live container/volume inventory has been verified.
- The upstream Pi kit currently declares Anthropic credentials and can materialize Pi auth.json at startup. Do not adopt that credential declaration for this deployment: it could interfere with manually stored Codex authentication.

## Implementation sequence

### 1. Prove host/runtime feasibility

- Install sbx on the Mac with the user's approval (`brew trust docker/tap`, `brew install docker/tap/sbx`), then the user performs `sbx login`.
- Record the tested sbx version and inspect installed CLI help before encoding command syntax.
- Prove creation of a named mountless environment using `sbx create` without a workspace path. Do not use bare `sbx run` for initial creation: it defaults to sharing the current host directory.
- Verify how local custom images/templates are loaded. Ordinary Docker Engine images are not assumed to be automatically available in sbx's separate runtime.
- Determine whether a custom kit or explicit template is the simplest supported packaging route; capture a minimal working example before porting the whole environment.

Gate: a named environment starts without host workspace mounts and can run a shell, stop, and restart with a canary file intact.

### 2. Package the existing environment

- Add a separate `sandbox/` environment definition/build recipe and retain the existing Compose path until cutover.
- Reuse pinned runtime manifests/lockfiles and non-secret defaults where appropriate. Preserve the recommended tools, extensions, LSP setup, Python/uv, Git, and tmux.
- Explicitly reconcile `/home/node` versus the sandbox template's user/home and `/workspace` versus `/home/agent/workspace`; do not blindly reuse path-specific initialization.
- Create a writable in-sandbox workspace and Pi config directory. Do not initialize plaintext Git credential storage by default.
- Exclude local .env files, auth stores, Git credentials, repository workspaces, and runtime state from all image build contexts/artifacts. Never save a logged-in sandbox as a distributable template.
- Document the user-selected allow-all outbound network policy and accepted exfiltration trade-off. Do not add a project destination allowlist or silently reset host policies.
- Do not request shared host skills or host integrations unnecessarily. Verify effective mounts/policies, not only the declared workspace.

Gate: all expected versioned tools/extensions initialize in a fresh environment with no embedded secrets.

### 3. Validate Codex and Git authentication

- Run Pi `/login` interactively inside the sandbox. Use device-code login if supported by the chosen Pi version, otherwise the browser/pasted callback flow. The user completes authentication; automation must not print or copy tokens.
- Verify a Codex prompt, streaming, a new Pi process, sandbox restart, and token refresh when testable. Distinguish passing initial auth from untested refresh.
- Confirm no engine-managed auth-file rewrite replaces Codex credentials on restart.
- Verify `gh` is authenticated on the host without exposing its token, then configure the host-side GitHub resolver and minimum required kit bindings/network rules.
- Test private repository clone/fetch and an explicitly approved disposable branch push. Do not infer Git HTTPS compatibility from a successful GitHub API request alone.
- Disable SSH-agent forwarding via supported settings, reviewing whether those settings affect other sandboxes before changing global defaults.
- If Git proxying fails, report the concrete incompatibility and ask before adding a real Git token inside the sandbox. Custom model OAuth integration remains out of scope.

Gate: Codex is usable and persistent; Git access is working with its actual credential boundary documented.

### 4. Implement lifecycle and remote access

- Add sandbox-specific Make targets or a wrapper for build/create, background start, shell/exec, status, and stop. Existing `make up` remains Compose-based until the documented cutover. Neither runtime has a Make attach target.
- Use a stable configurable sandbox name. Existing-name attachment must never silently create a new environment with a host mount.
- Use detached/background mode to keep the VM running without client sessions. Session management (including optional tmux) is manual; do not create sessions or launch Pi automatically.
- Confirm `sbx exec` starts a shell with the expected environment and working directory. Validate tmux reconnection after an SSH client disconnect.
- Stop/start retains files and credentials but ends running processes; host reboot does not preserve a live tmux/Pi process. Document explicit restart steps and Mac sleep/availability limitations rather than promising uninterrupted execution.
- No automatic remove-on-exit, pruning, reset, or recreation in normal update/start paths. Sandbox removal deletes repositories, credentials, and local state.
- Add guarded, explicitly destructive removal only if needed. Never use broad Docker volume/system pruning.

Gate: the same environment and repositories survive reconnect and stop/start; session lifecycle is accurately described.

### 5. Tests and documentation

- Add static tests for sandbox definitions/build exclusions, no unintended host shares, no automatic deletion, and absence of model proxy/auth-file injection.
- Add explicit opt-in integration smoke tests for runtime tools, persistence, effective mounts, networking, and tmux. Authentication checks should report success/failure without exposing credential values.
- Keep existing tests passing while Compose remains supported. Run `npm test` and applicable image/integration checks; record skipped live checks as unverified.
- Update README with installation, named mountless creation, login, host-backed Git setup, fresh clone, SSH/tmux access, stop/start, updates, rebuild/data-loss warnings, and secret handling.
- Document the accepted Codex-token risk prominently. Sanitise logs and avoid secret-bearing traces/snapshots.
- Measure resource use on the Mac, at idle and during a representative task. Do not promise an overhead figure without measurement.

Gate: repeatable fresh setup instructions and passing tests, with all manual/unverified steps recorded.

### 6. Cutover and scoped cleanup

- Inventory old containers and actual volume names when the Docker daemon is available. Include optional sidecar data in the inventory; it is not automatically covered by pushed Git repositories.
- User confirms any remaining branches, ignored/untracked files, sidecar data, and secrets can be discarded.
- Start using fresh clones in the validated sandbox. Keep old resources until the new environment is accepted.
- Stop/remove only the intended old containers and explicitly named volumes after a final deletion confirmation. Do not use `sbx reset`, global prune, or unrelated resource deletion.
- Reissue/revoke superseded Git credentials where appropriate. Reuse the host GitHub login as a resolver only if its scope is acceptable; a newly minted token is not inherently required.
- Switch the primary documented/default workflow to sbx in a deliberate change. Decide whether Compose remains an alternate path or is removed; do not leave ambiguous Make targets.

## Out of scope

- Host-side Codex OAuth proxy implementation.
- Optional host workspace sharing.
- Moving old Pi history or existing volume files.
- Remote/cloud deployment and sidecar parity for the initial milestone.

## References

- https://github.com/seitaro-white/pi-box/issues/17
- https://pi.dev/docs/latest/containerization
- https://docs.docker.com/ai/sandboxes/install/
- https://docs.docker.com/ai/sandboxes/usage/
- https://docs.docker.com/ai/sandboxes/configuration/credentials/
- https://github.com/docker/sbx-kits-contrib/tree/main/pi
