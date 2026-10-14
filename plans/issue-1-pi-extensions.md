# Issue #1: minimal build-time Pi extension bundles

Branch: `feat/1-build-time-pi-extensions`.

## Agreed scope

- `container/package.json` remains the authoritative declaration of exact recommended runtime dependencies; commit npm lockfiles.
- Pins: Pi 1.2.0, pi-subagents 0.78.0, pi-web-access 0.40.0, @sreetej510/pi-usage 0.10.13. Preserve the existing protobufjs override.
- Docker targets `base` (Pi only, plus existing development tools) and `recommended` (default, with the three extensions).
- Derive the base manifest and package registrations from the authoritative manifest, with a drift check; no custom requirements format or inventory.
- Register bundled extensions by default. Reconcile only image-owned references when replacing images or switching variants; preserve unrelated operator settings, credentials, history, and existing resource filters for retained packages.
- Provide straightforward npm update, build, and test instructions.
- Test both variants locally, offline and without model credentials. Exercise variant transitions against disposable state.
- Defer CI/architecture automation to issue #4 and registry publishing to later work. No importer or new activation toggle.

## Implementation checklist

1. Update runtime pins and lockfiles; add minimal generation/drift checking for the base manifest and default package registrations.
2. Split Dockerfile into base/recommended targets without copying recommended dependencies into the base image.
3. Reconcile image-managed package registrations safely and add host tests for both variants and transitions.
4. Make disposable offline smoke tests profile-aware, including extension loading and package absence checks; run both images locally.
5. Update README with build selection and dependency-update workflow; review changes and report validation limits.

## Validation

All implementation steps completed. Both Docker targets built locally on ARM64 macOS; host manifest/lock/defaults checks, startup preservation/migration tests, both full offline image smoke suites, and the disposable shared-volume variant transition suite passed. Test containers/volumes cleaned up by their owned names. Test images retained as `pi-box:issue-1-base` and `pi-box:issue-1-recommended`; existing development resources were not replaced.

AMD64, Linux/Windows hosts, Podman, credentialed login, provider-usage requests, and model calls remain unverified. No CI, registry publishing, commit, or push performed.

## Public-facing test cleanup

Follow-up requested by the user: keep tests minimal and use Node's built-in runner. `npm test` runs eight focused cases (two manifest contracts and six startup/state regressions) with isolated temporary state and automatic cleanup. `npm run test:integration` checks both prebuilt images for startup, exact package pins, extension registration, user/permissions and storage persistence, then checks recommended → base → recommended with synthetic operator state. Container assertions/data live in `tests/fixtures/`; shared setup lives in `tests/helpers/`; shell scripts handle container lifecycle. Terminal/PTY/Unicode checks and synthetic session machinery were removed for now. No test framework dependency added. All eight fast tests and the reduced integration suite passed on the existing ARM64 Docker test images.
