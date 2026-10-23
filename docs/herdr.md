# Herdr (recommended image)

[Herdr](https://herdr.dev/) is an agent-aware terminal multiplexer. Pi-box uses Herdr's official installer to fetch its latest stable release when the installation layer is rebuilt in the `recommended` image, not `base` or the separate Docker Sandboxes image. It runs inside Pi-box as `node`, under the same restrictions as Pi. No sidecar, host installation, cloud account, web service or published port is needed.

Herdr is **optional and manually launched**. The container still starts tmux, with its existing healthcheck and attach workflow. Installing the image does not move existing tmux sessions, start Herdr or start agents.

## First use

Use a separate host terminal, rather than nesting Herdr in your current tmux client. Check for an existing Pi integration before installing:

```sh
docker compose exec pi-box sh -c '
  file="$PI_CODING_AGENT_DIR/extensions/herdr-agent-state.ts"
  if [ -e "$file" ] || [ -L "$file" ]; then
    printf "Already present; inspect before replacing: %s\n" "$file"
  else
    herdr integration install pi
  fi
'
```

The upstream installer writes this extension into the persistent agent volume. If it already exists, inspect it before deliberately refreshing; the installer can replace that file. Do not overwrite an unknown operator extension. The image never synchronizes global Pi extensions automatically.

Open Herdr in a project directory:

```sh
docker compose exec -w /workspace/my-project pi-box herdr
```

Replace the directory with an existing project. Without `-w`, the starting directory is `/workspace`. Follow upstream onboarding, then run `pi` in a pane. New Pi sessions load the integration and report their activity and native conversation identity. Existing Pi sessions are not migrated; sessions outside Herdr can continue normally.

Use the mouse to navigate workspaces/tabs, split panes and resize borders. Each pane is a real terminal: use it for an agent, shell, tests or development server. Agent status rolls up into the sidebar. Status detection is advisory, not authorization to approve a command, and not a substitute for checking the actual agent output.

- **Detach:** press `Ctrl+b`, release, then `q` (or close the client terminal).
- **Reattach:** run the same `docker compose exec ... herdr` command.
- **Stop Herdr and its panes deliberately:** `docker compose exec pi-box herdr server stop`.

Detaching does not stop jobs while the container and host keep running. Herdr does not keep a sleeping laptop computing. Container restart/replacement kills live processes. On the next manual launch, Herdr can restore saved layouts and resume supported agent conversations; it does not resurrect arbitrary jobs. Restoring an agent runs its normal startup and may use network access. Save important work and stop processes deliberately before replacement.

Avoid launching tmux **inside** Herdr panes: agent detection cannot see through nested tmux. An outer tmux can also intercept Herdr's default `Ctrl+b` prefix, which is why a separate terminal is simplest. This dashboard manages interactive sessions; it is not automatic supervision or a separate entry for every `pi-subagents` child.

## Persistence and worktrees

Pi-box links Herdr's standard directories into its existing agent volume:

| Standard location | Persistent location |
|---|---|
| `~/.config/herdr` | `/home/node/.pi/agent/herdr/config` |
| `~/.local/state/herdr` | `/home/node/.pi/agent/herdr/state` |

Startup creates private target directories and seeds config **only if absent**. Existing config is left unchanged. No new volume or global XDG override is introduced. Keep this state private: layout/history/log files can contain sensitive terminal output, paths and commands. Do not commit them or share raw logs.

Fresh config sets the worktree root to `/workspace/.worktrees`, so checkouts survive replacement. Existing operator settings win; if your configured worktree path is outside persistent storage, those files are disposable. Herdr's upstream default `~/.herdr/worktrees` is not persistent in Pi-box.

Example, with Herdr running:

```sh
docker compose exec pi-box herdr worktree create \
  --cwd /workspace/my-project --branch feature/example
```

Herdr creates the checkout and a grouped workspace. Start Pi there separately; creating a worktree does not automatically assign a task or start an agent. Worktrees isolate checked-out files/branches, not databases, ports or network services. Closing a workspace is not the same as deleting its checkout; `herdr worktree remove --workspace <id>` removes a checkout but retains its branch. Review/merge branches normally and avoid forcing removal of uncommitted work.

## Phone access

Use your existing secure SSH route to the Pi-box host (for example via Tailscale), then run `docker compose exec pi-box herdr` in the phone's SSH app. The terminal UI adapts to narrow screens. This is not a mobile/web app, and there is no HTTP port to forward. Adding host SSH access or Tailscale is outside this integration. Work continues after you disconnect while the host/container stay running.

## Updates and rollback

The binary is root-owned and installed using the official installer, which selects the architecture and verifies the release checksum. No version or checksum is frozen in this repo. Docker may reuse the installation layer: to fetch the current release, run `docker compose build --no-cache pi-box`, then rerun disposable acceptance before replacing the live container. `herdr --version` reports what the image contains. Do not use `herdr update` in a running container. A new image does not update the extension in the agent volume: inspect the existing file and deliberately refresh with `herdr integration install pi` after compatibility checks. `herdr integration status` reports installation status.

Upstream enables version checks and downloads updated agent-detection manifests by default. Those checks are independent of the image's installed binary. If you prefer no background update requests, add this to the operator-owned `~/.config/herdr/config.toml` and restart Herdr deliberately when convenient:

```toml
[update]
version_check = false
manifest_check = false
```

For rollout, preserve/tag the current image before building over its tag. Check disposable-test results first, agree an interruption window, stop jobs, and use the normal `make build` / preflight / `make replace` workflow. No automatic rollout is part of installation tests.

Before returning to an image without Herdr:

1. Stop Herdr deliberately; preserve the persistent state and any uncommitted work.
2. While the executable is still available, remove its extension with `docker compose exec pi-box herdr integration uninstall pi`. Do not remove an unrelated replacement extension.
3. Select the previous image and use the normal preflight/replacement workflow. Never delete named volumes or use `docker compose down -v`.

Changing the image alone does not uninstall global Pi extensions. Herdr's saved data and worktrees remain in the existing volumes; rollback does not delete them. Resume compatibility across arbitrary downgrades is not guaranteed.

## Validation

See [tests](../tests/README.md). Automated tests use disposable storage, no credentials and no model calls. Actual terminal navigation, two live Pi sessions' status and real conversation resume are manual acceptance checks, not claims inferred from a successful image build.

Upstream: [CLI](https://herdr.dev/docs/cli-reference/), [integrations](https://herdr.dev/docs/integrations/), [state and restore](https://herdr.dev/docs/session-state/).
