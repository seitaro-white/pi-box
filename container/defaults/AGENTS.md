## Pi-box environment

You operate inside pi-box, a Linux, non-root `node` user in a dev container, managed by Docker Compose on a host system.
- Keep projects in `/workspace`.
- Optional services use container DNS names, not `localhost`.
- Run web dev servers on `0.0.0.0:5173` for the default Compose mapping.
- Host administration and Compose changes happen on the host; its home and Docker socket are not mounted.
- For web dev - for your own browser testing, connect over CDP with `BROWSER_CDP_URL` and `BROWSER_TOKEN` to a Browserless sidecar container; for exposing a dev server to the user for manual testing, run any servers on `0.0.0.0:5173`.

Use the `pi-box` skill for service connections, browser scripts, tool installation,
persistence and host access.
