# Herdr in Pi-box

Included in the `recommended` image and launched manually; tmux remains the default.

```sh
docker compose exec -w /workspace/my-project pi-box herdr
```

At container startup, Pi-box runs the official `herdr integration install pi` after initializing the persistent Pi directory. Herdr installs its bundled reporter at `~/.pi/agent/extensions/herdr-agent-state.ts` (or `$PI_CODING_AGENT_DIR/extensions/herdr-agent-state.ts`). This does not start the Herdr server or require network access. Restarting/replacing the container refreshes this Herdr-managed file to match the installed binary; don't edit it directly.

The separately published `@muzi3/herdr-agent-state` npm package is no longer bundled. Startup removes its old image-owned package reference from existing Pi settings through the normal package ownership reconciliation. Operator-installed npm/git copies are not removed automatically: remove those yourself to avoid duplicate reporters. No manual uninstall is needed for a previous official integration; the installer refreshes it.

## Pi skill

The recommended image exposes Herdr's official skill at `~/.agents/skills/herdr/SKILL.md`, generated from `herdr --skill` during the build so it matches the installed CLI. This image-owned location is outside the persistent Pi volume, so existing volumes receive the skill on container replacement too. Restart Pi or use `/reload` to discover it.

Ask Pi to use Herdr, or invoke `/skill:herdr` explicitly. The skill intentionally activates only when you mention Herdr or explicitly request its use, not merely because a task might benefit from parallel work. It requires Pi to be running in a Herdr-managed pane (`HERDR_ENV=1`); it teaches Pi to use the CLI through bash rather than registering new tools.

## Agents, panes, and pi-subagents

Herdr is a terminal runtime and orchestration CLI, not a replacement for `pi-subagents`. An agent can use its shell tool to split panes, start another Pi (or another supported agent), submit prompts, wait for lifecycle state, and read terminal output. See [Agent automation](https://herdr.dev/docs/agent-automation/). The status integration alone does not register orchestration tools in Pi or automatically delegate work.

The bundled `pi-subagents` also has explicit Herdr support:

- Ordinary subagent runs retain their existing execution and result handling; they do not automatically become interactive Herdr agent panes.
- Herdr inspector panes show subagent dashboards, not a live attached child terminal.
- `project.open` / `project.status` / `project.close` open and manage peer Pi sessions in other projects. Each peer owns its own subagents; existing headless runs are not moved into that pane.
- Inside Herdr, the extension publishes background-work counts and labels as pane metadata alongside the official lifecycle reporter. This is intentionally separate from lifecycle/session authority. The parent can appear idle while its background children are still working; do not treat the parent's idle state as proof that all children have finished.

For example, the bundled subagent tool can open a peer project session:

```js
subagent({ action: "project.open", cwd: "/workspace/another-project", message: "Review this project's test coverage." })
```

Keep `pi-subagents` for structured subtasks and collected results; use Herdr panes for visible interactive sessions and project-level coordination. Avoid dispatching the same task through both paths or letting concurrent agents edit the same checkout without coordination/worktree isolation.

## Pi-box storage

The `pi-box-herdr` volume mounts at `~/.herdr` (`HERDR_VOLUME` overrides its name).

- `~/.config/herdr` → `~/.herdr/config`
- `~/.local/state/herdr` → `~/.herdr/state`
- Worktree checkouts remain in `/workspace/.worktrees`.

Docker seeds fresh Herdr volumes from the image. Existing Herdr config is preserved; the startup integration install writes only the managed Pi extension in the agent volume. Keep worktrees inside mounted storage to survive container replacement.

The official installer fetches the latest release at build time. Use `docker compose build --no-cache pi-box` to refresh a cached installation layer.

For configuration and usage, see the [Herdr docs](https://herdr.dev/docs/).
