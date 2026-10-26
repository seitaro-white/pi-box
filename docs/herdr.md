# Herdr in Pi-box

The `recommended` image includes [Herdr](https://herdr.dev/docs/) for interactive
agent panes. Start it in your project:

```sh
docker compose exec -w /workspace/my-project pi-box herdr
```

## Use with Pi

Ask Pi to use Herdr or invoke `/skill:herdr` from a Herdr-managed pane.
The bundled skill teaches Pi the Herdr CLI; the startup-installed official
integration reports session identity and lifecycle state.

Use Herdr for visible interactive sessions and project coordination;
`pi-subagents` handles structured subtasks and collected results. Its
`project.open` action opens a peer Pi session:

```js
subagent({ action: "project.open", cwd: "/workspace/another-project", message: "Review this project's test coverage." })
```

Inspector panes show subagent dashboards, not attached child terminals. Background
work is reported separately, so an idle parent pane can still have working children.
Use separate worktrees for concurrent edits.

## Storage and updates

The Herdr volume mounts at `~/.herdr` (`HERDR_VOLUME` overrides its name):

- `~/.config/herdr` → `~/.herdr/config`
- `~/.local/state/herdr` → `~/.herdr/state`
- Worktrees: `/workspace/.worktrees`

Configuration and state survive container replacement. The official Pi reporter
is refreshed at startup; the matching skill lives at `~/.agents/skills/herdr`.
Use Pi's `/reload` after skill updates.

Herdr's installer fetches the latest release at build time. Rebuild with
`docker compose build --no-cache pi-box`, then replace the container to update it.
