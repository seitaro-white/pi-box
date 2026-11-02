#!/bin/sh
set -eu

mise install --locked

# Export self-contained artifacts by image profile; no runtime mise activation.
install -d /out/cloud/opt /out/cloud/usr/local/bin \
    /out/python/opt /out/review/opt/herdr /out/review/usr/local/bin

cp -a "$(mise where gcloud)" /out/cloud/opt/google-cloud-sdk
install -m 0755 "$(mise which terraform)" /out/cloud/usr/local/bin/terraform
for tool in gcloud gsutil bq; do
    ln -s "/opt/google-cloud-sdk/bin/$tool" "/out/cloud/usr/local/bin/$tool"
done

for tool in ruff ty; do
    install -D -m 0755 "$(mise which "$tool")" "/out/python/opt/$tool/$tool/bin/$tool"
done

cp -a "$(dirname "$(mise which hunk)")" /out/review/opt/hunk
install -m 0755 "$(mise which herdr)" /out/review/usr/local/bin/herdr
/out/review/usr/local/bin/herdr --skill > /out/review/opt/herdr/SKILL.md
