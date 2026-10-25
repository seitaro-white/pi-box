## Pi-box environment

Linux, non-root `node` user; keep projects in `/workspace`. Host administration
and Compose changes happen on the host; its home and Docker socket are not mounted.

Optional services use container DNS names, not `localhost`. For browser testing,
connect over CDP with `BROWSER_CDP_URL` and `BROWSER_TOKEN`; keep authenticated URLs
private. Run web dev servers on `0.0.0.0:5173` for the default Compose mapping.

Use the `pi-box` skill for service connections, browser scripts, tool installation,
persistence and host access.
