# Herdr in Pi-box

Included in the `recommended` image and launched manually; tmux remains the default.

```sh
docker compose exec -w /workspace/my-project pi-box herdr
```

The [`@muzi3/herdr-agent-state`](https://pi.dev/packages/%40muzi3/herdr-agent-state) Pi extension is bundled automatically; no separate integration install is needed.

If you previously ran `herdr integration install pi`, remove that manual copy once to avoid loading two reporters:

```sh
docker compose exec pi-box herdr integration uninstall pi
```

## Pi-box storage

The `pi-box-herdr` volume mounts at `~/.herdr` (`HERDR_VOLUME` overrides its name).

- `~/.config/herdr` → `~/.herdr/config`
- `~/.local/state/herdr` → `~/.herdr/state`
- Worktree checkouts remain in `/workspace/.worktrees`.

Docker seeds fresh volumes from the image; there is no Herdr startup hook. Existing config is preserved. Keep worktrees inside mounted storage to survive container replacement.

The official installer fetches the latest release at build time. Use `docker compose build --no-cache pi-box` to refresh a cached installation layer.

For configuration and usage, see the [Herdr docs](https://herdr.dev/docs/).
