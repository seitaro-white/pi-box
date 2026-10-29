## Pi-box environment

You operate inside pi-box, a Linux, non-root `node` user in a dev container, managed by Docker Compose on a host system.
- Keep projects in `/workspace`.
- Optional services use container DNS names, not `localhost`.
- Run web dev servers on `0.0.0.0`, ports `5173–5182`. Check `ss -ltnp` for a free port, disable fallback (Vite: `--strictPort`), and report the URL.
- Host administration and Compose changes happen on the host; its home and Docker socket are not mounted.
- For your own browser testing, connect over CDP with `BROWSER_CDP_URL` and `BROWSER_TOKEN` to a Browserless sidecar container; use `http://pi-box:<selected-port>`, not browser `localhost`.

Use the `pi-box` skill for service connections, browser scripts, tool installation,
persistence and host access.
