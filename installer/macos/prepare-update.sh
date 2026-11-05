#!/bin/bash
set -euo pipefail
[ "$#" -eq 2 ] || { echo 'Usage: prepare-update.sh OUTPUT_DIRECTORY VERSION' >&2; exit 2; }
OUT=$(cd "$1" && pwd -P)
VERSION=$2
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'A stable release version is required.' >&2; exit 2; }
SPARKLE=${SPARKLE_DISTRIBUTION_DIR:?Set SPARKLE_DISTRIBUTION_DIR to the verified Sparkle distribution}
APP="$OUT/Aside Automation Creator.app"
/usr/bin/codesign --verify --deep --strict -R='anchor apple generic and identifier "com.tamcut.aside-automation-creator" and certificate leaf[subject.OU] = "9SADL7543X"' "$APP"
/usr/sbin/spctl --assess --type execute "$APP"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")" = "$VERSION" ] || { echo 'App and release versions differ.' >&2; exit 1; }
EXPECTED_KEY=$(cat "$(dirname "$0")/sparkle-public-key.txt")
[ "$("$SPARKLE/bin/generate_keys" --account aside-automation-creator -p)" = "$EXPECTED_KEY" ] || { echo 'Sparkle signing key differs from the shipped public key.' >&2; exit 1; }
WORK=$(mktemp -d "${TMPDIR:-/tmp}/aac-update.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
ZIP="AsideAutomationCreator-$VERSION-macOS.zip"
/usr/bin/ditto -c -k --keepParent "$APP" "$WORK/$ZIP"
FEED="$(dirname "$0")/appcast.xml"
if [ -f "$FEED" ]; then cp "$FEED" "$WORK/appcast.xml"; fi
"$SPARKLE/bin/generate_appcast" --account aside-automation-creator --maximum-deltas 0 --download-url-prefix "https://github.com/2JIHAN/aside-automation-creator/releases/download/v$VERSION/" --link 'https://github.com/2JIHAN/aside-automation-creator' "$WORK"
cp "$WORK/$ZIP" "$OUT/$ZIP"
cp "$WORK/appcast.xml" "$OUT/appcast.xml"
(cd "$OUT"; shasum -a 256 "$ZIP" > "$ZIP.sha256")
printf 'Prepared signed update: %s\nFeed: %s\n' "$OUT/$ZIP" "$OUT/appcast.xml"
printf 'Upload the archive to release v%s before publishing appcast.xml. This script does not publish anything.\n' "$VERSION"
