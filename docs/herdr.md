# Herdr in Pi-box

Included in the `recommended` image and launched manually; tmux remains the default.

```sh
docker compose exec pi-box herdr integration install pi
docker compose exec -w /workspace/my-project pi-box herdr
```

The Pi integration lives in the persistent agent volume. Check any existing `~/.pi/agent/extensions/herdr-agent-state.ts` before installing or refreshing it; image rebuilds do not update that file.

## Pi-box storage

The `pi-box-herdr` volume mounts at `~/.herdr` (`HERDR_VOLUME` overrides its name).

- `~/.config/herdr` → `~/.herdr/config`
- `~/.local/state/herdr` → `~/.herdr/state`
- Worktree checkouts remain in `/workspace/.worktrees`.

Docker seeds fresh volumes from the image; there is no Herdr startup hook. Existing config is preserved. Keep worktrees inside mounted storage to survive container replacement.

The official installer fetches the latest release at build time. Use `docker compose build --no-cache pi-box` to refresh a cached installation layer.

For configuration and usage, see the [Herdr docs](https://herdr.dev/docs/).
