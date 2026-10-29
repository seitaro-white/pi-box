# Herdr in Pi-box

The `recommended` image includes [Herdr](https://herdr.dev/docs/) for interactive
agent panes. Start it in your project:

```sh
docker compose exec -w /workspace/my-project pi-box herdr
```

## Use with Pi

Ask Pi to use Herdr or invoke `/skill:herdr` from a Herdr-managed pane.
The bundled skill teaches Pi the Herdr CLI; the startup-installed official
integration reports session identity and lifecycle state. A bundled bridge maps
RPIV questionnaire waits to Herdr's blocked state, clearing it when you answer,
cancel, or the questionnaire fails.

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
and the Pi-box question bridge (`~/.pi/agent/extensions/herdr-question-state.ts`)
are refreshed at startup; the matching skill lives at `~/.agents/skills/herdr`.
Keep custom hooks in separate files. Use Pi's `/reload` after integration or
skill updates.

Herdr is pinned by `HERDR_VERSION` and per-architecture checksums in the
`Dockerfile`. To update it, change all three from the release's entries in
`https://herdr.dev/latest.json`, then run `make up`.
