#!/usr/bin/env bash
# Build the installable plugin zip: dist/kismet-telemetry-<version>.zip with a
# top-level kismet-telemetry/ folder, as WordPress expects. Version is read from
# the plugin header.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/^ \* Version:[[:space:]]*//p' kismet-telemetry.php | head -1)
[ -n "$VERSION" ] || { echo "no Version header" >&2; exit 1; }
node scripts/generate-bot-patterns.mjs --check
for f in kismet-telemetry.php includes/*.php; do php -l "$f" >/dev/null; done
rm -rf dist/stage && mkdir -p dist/stage/kismet-telemetry
cp -R kismet-telemetry.php includes readme.txt LICENSE NOTICE dist/stage/kismet-telemetry/
( cd dist/stage && rm -f "../kismet-telemetry-${VERSION}.zip" && zip -qr "../kismet-telemetry-${VERSION}.zip" kismet-telemetry )
rm -rf dist/stage
ls -la "dist/kismet-telemetry-${VERSION}.zip"
