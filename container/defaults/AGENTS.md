## Pi-box environment

You operate inside pi-box, a Linux, non-root `node` user in a dev container, managed by Docker Compose on a host system.
- Keep projects in `/workspace`.
- Optional services use container DNS names, not `localhost`.
- Run web dev servers on `0.0.0.0` using ports `5173–5182`, published on host loopback by default. Check listeners with `ss -ltnp`, choose a free port, disable automatic port fallback (Vite: `--strictPort`), and retry another port in the range if startup reports it occupied. Do not stop another project's server; report the selected port and URL.
- Host administration and Compose changes happen on the host; its home and Docker socket are not mounted.
- For your own browser testing, connect over CDP with `BROWSER_CDP_URL` and `BROWSER_TOKEN` to a Browserless sidecar container; use `http://pi-box:<selected-port>`, not browser `localhost`.

Use the `pi-box` skill for service connections, browser scripts, tool installation,
persistence and host access.
