#!/bin/sh
# Run inside the container. Mounted Git state is checked separately on the host.
set -eu
for path in /home/node/.gitconfig /home/node/.git-credentials /home/node/.ssh; do
    if [ -e "$path" ] || [ -L "$path" ]; then
        echo "Refusing replacement: non-persistent $path exists. Preserve it manually before replacing the container." >&2
        exit 1
    fi
done
