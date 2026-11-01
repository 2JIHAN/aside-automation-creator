#!/bin/bash
set -euo pipefail
[ "$(uname -s)" = Darwin ] || { echo 'Build requires macOS and Xcode command line tools.' >&2; exit 1; }
[ "${1:-}" = --build ] || { echo 'Usage: build.sh --build OUTPUT_DIRECTORY [VERSION]' >&2; exit 1; }
OUT=${2:?Output directory required}
VERSION=${3:-0.0.0}
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || exit 1
ROOT=$(cd "$(dirname "$0")/../.." && pwd -P)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd -P)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/aac-macos-build.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/image/Aside Automation Creator 설치.app"
RES="$APP/Contents/Resources"
mkdir -p "$APP/Contents/MacOS" "$RES/payload" "$RES/cli" "$RES/runtime" "$WORK/icon.iconset"
for item in SKILL.md engine.mjs README.md install-to-aside.sh assets; do /bin/cp -R "$ROOT/$item" "$RES/payload/"; done
/bin/cp "$ROOT/installer/macos/bootstrap.sh" "$RES/"
NODE_VERSION=v26.13.0
curl --proto '=https' --tlsv1.2 -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
for arch in arm64 x64; do
  archive="node-$NODE_VERSION-darwin-$arch.tar.gz"
  curl --proto '=https' --tlsv1.2 -fsSL "https://nodejs.org/dist/$NODE_VERSION/$archive" -o "$WORK/$archive"
  expected=$(awk -v f="$archive" '$2 == f {print $1}' "$WORK/SHASUMS256.txt")
  [ "${#expected}" -eq 64 ] && [ "$(shasum -a 256 "$WORK/$archive" | awk '{print $1}')" = "$expected" ] || { echo 'Node checksum mismatch' >&2; exit 1; }
  tar -xzf "$WORK/$archive" -C "$WORK"
  node="$WORK/node-$NODE_VERSION-darwin-$arch/bin/node"
  /usr/bin/codesign --verify --strict -R='anchor apple generic and certificate leaf[subject.OU] = "HX7739G8FX"' "$node"
  mkdir -p "$RES/runtime/$arch"
  /bin/cp "$node" "$RES/runtime/$arch/node"
  /bin/cp "$WORK/node-$NODE_VERSION-darwin-$arch/LICENSE" "$RES/runtime/$arch/NODE-LICENSE.txt"
  printf '%s  %s\n' "$expected" "$archive" >> "$RES/vendor-sha256.txt"
  curl --proto '=https' --tlsv1.2 -fsSL "https://releases.aside.com/cli/AsideCLI-darwin-$arch-latest.zip" -o "$RES/cli/$arch.zip"
  mkdir -p "$WORK/cli-$arch"
  /usr/bin/ditto -x -k "$RES/cli/$arch.zip" "$WORK/cli-$arch"
  /usr/bin/codesign --verify --deep --strict -R='anchor apple generic and certificate leaf[subject.OU] = "8CPD4K4TBB"' "$WORK/cli-$arch/Aside CLI.app"
  /usr/sbin/spctl --assess --type execute "$WORK/cli-$arch/Aside CLI.app"
  shasum -a 256 "$RES/cli/$arch.zip" | sed "s|$RES/cli/||" >> "$RES/cli-sha256.txt"
done
for size in 16 32 128 256 512; do
  /usr/bin/sips -z "$size" "$size" "$ROOT/assets/readme/robot-laptop-transparent.png" --out "$WORK/icon.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  /usr/bin/sips -z "$double" "$double" "$ROOT/assets/readme/robot-laptop-transparent.png" --out "$WORK/icon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
/usr/bin/iconutil -c icns "$WORK/icon.iconset" -o "$RES/Installer.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Installer</string>
<key>CFBundleIdentifier</key><string>com.tamcut.aside-automation-creator.installer</string>
<key>CFBundleName</key><string>Aside Automation Creator 설치</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>CFBundleVersion</key><string>$VERSION</string>
<key>CFBundleIconFile</key><string>Installer</string>
<key>LSMinimumSystemVersion</key><string>13.5</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
for target in arm64 x86_64; do
  xcrun swiftc -swift-version 5 -O -target "$target-apple-macosx13.5" -framework AppKit "$ROOT/installer/macos/Installer.swift" -o "$WORK/Installer-$target"
done
/usr/bin/lipo -create "$WORK/Installer-arm64" "$WORK/Installer-x86_64" -output "$APP/Contents/MacOS/Installer"
if [ -n "${CODE_SIGN_IDENTITY:-}" ]; then
  /usr/bin/codesign --force --options runtime --timestamp --sign "$CODE_SIGN_IDENTITY" "$APP"
else
  echo 'WARNING: ad-hoc signed, UNNOTARIZED build. Not for public distribution.' >&2
  /usr/bin/codesign --force --sign - "$APP"
fi
/usr/bin/codesign --verify --deep --strict "$APP"
# Never use --deep to sign: preserve the Node vendor signatures.
for arch in arm64 x64; do /usr/bin/codesign --verify --strict -R='anchor apple generic and certificate leaf[subject.OU] = "HX7739G8FX"' "$RES/runtime/$arch/node"; done
/usr/bin/ditto "$APP" "$OUT/Aside Automation Creator 설치.app"
DMG="$OUT/AsideAutomationCreator-$VERSION-macOS-Setup.dmg"
/usr/bin/hdiutil create -volname 'Aside Automation Creator 설치' -srcfolder "$WORK/image" -format UDZO -ov "$DMG" >/dev/null
shasum -a 256 "$DMG" > "$DMG.sha256"
printf 'Built %s\nNotarization is a separate release gate.\n' "$DMG"
