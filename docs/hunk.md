# Hunk in Pi-box

The `recommended` image bundles [Hunk](https://github.com/modem-dev/hunk), a standalone terminal diff reviewer. It does not require a Herdr plugin. Herdr remains available for arranging panes; the separate Herdr Plannotator-TUI/Annotate plugin is not bundled. This setup does not remove or change operator-installed Plannotator integrations.

## Review with Pi

In a terminal or Herdr pane inside the container, open Hunk from your repository:

```sh
hunk diff
# Or follow changes while Pi edits:
hunk diff --watch
```

In Pi, ask it to use Hunk against the live review session, or invoke the skill explicitly:

```text
/skill:hunk-review Review the changes in my live Hunk session.
```

Press `c` in Hunk to leave your own comments, then ask Pi to read and address them. Pi can list user notes and reply to them; it does not automatically watch for new comments. You can also ask Pi to perform a review or walk you through changes: it can navigate the diff, highlight expressions, and add its own inline review comments. Press `a` in Hunk to show agent notes (hidden by default).

The skill instructs Pi to use `hunk session ...` against your live session, not launch the interactive viewer itself. Open Hunk in the same container as Pi so they can reach the same local session daemon. Hunk is not an extra Pi tool or a Pi extension.

## Skill discovery and upgrades

Hunk is pinned by `HUNK_VERSION` in `Dockerfile` and installed, with its matching bundled skills, under `/opt/hunk`. `/usr/local/bin/hunk` points to the binary; `~/.agents/skills/hunk-review` points to its bundled review skill. Pi discovers this standard user skill location automatically, even when an existing persistent `~/.pi/agent` volume is mounted. No startup download, `npx skills add`, or edits to personal Pi settings are needed.

Rebuild and replace the container to update the image-owned binary and skill. Existing Pi sessions need `/reload` or a restart to rediscover skills. Operator-configured skill exclusions or another skill with the same name can affect discovery; check Pi's diagnostics if `/skill:hunk-review` is missing.

To check the installation:

```sh
hunk --version
hunk skill show hunk-review
```

Hunk is omitted from the `base` image. Its live review sessions require a terminal; the image smoke tests verify CLI availability and Pi skill discovery without launching a model or an interactive review.
