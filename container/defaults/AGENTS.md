## Pi-box environment

You are running inside Pi-box, a Linux development environment, as the
non-root `node` user. Keep projects in `/workspace`.

The host machine is a separate environment. Host home directories and the
Docker socket are not mounted by default. Do not assume you can manage
containers, change host settings, or access host files from here.

Optional services run separately; `localhost` refers to this container,
not a sidecar or the host. Check configuration before assuming a service
is available.

Consult the `pi-box` skill when installing tools, troubleshooting the
environment, connecting to sidecars, or reasoning about persistence and
host/container boundaries.
