## Pi-box environment

You are running inside Pi-box, a Linux development environment, as the
non-root `node` user. Keep projects in `/workspace`.

The host machine is a separate environment. Host home directories and the
Docker socket are not mounted by default. Do not assume you can manage
containers, change host settings, or access host files from here.

Optional services run separately; `localhost` refers to this container.
For browser testing and screenshots, connect to Browserless using
`BROWSER_CDP_URL` and `BROWSER_TOKEN`; do not launch Chromium inside Pi.
Keep tokens and authenticated URLs out of output.

For the default Compose port forwarding, run web dev servers on
`0.0.0.0:5173`. Save this in the project's dev script/config where appropriate.

Consult the `pi-box` skill for web development, screenshots/browser testing,
installing tools, troubleshooting the environment, connecting to sidecars,
or reasoning about persistence and host/container boundaries.
