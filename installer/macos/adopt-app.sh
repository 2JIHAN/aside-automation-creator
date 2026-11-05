#!/bin/bash
set -euo pipefail
fail() { printf '앱 설치 중단: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 1 ] || fail '설치할 앱 경로가 필요합니다.'
[ "$(id -u)" -ne 0 ] || fail '관리자로 실행하지 마세요.'
SOURCE=$1
[ -d "$SOURCE" ] && [ ! -L "$SOURCE" ] || fail '앱이 없거나 심볼릭 링크입니다.'
SOURCE=$(cd "$SOURCE" && pwd -P)
if [ "${AAC_INSTALLER_FIXTURE:-}" = 1 ]; then
  [ -n "${AAC_FIXTURE_ROOT:-}" ] && [ -d "$AAC_FIXTURE_ROOT" ] && [ ! -L "$AAC_FIXTURE_ROOT" ] || fail '격리된 테스트 경로가 필요합니다.'
  FIXTURE=$(cd "$AAC_FIXTURE_ROOT" && pwd -P)
  case "$FIXTURE" in /private/tmp/aac-macos-test.*|/tmp/aac-macos-test.*|/private/var/folders/*/aac-macos-test.*) ;; *) fail '허용되지 않은 테스트 경로입니다.' ;; esac
  [ "$HOME" = "$FIXTURE/home" ] && [ ! -L "$HOME" ] || fail '테스트 홈 경로가 격리되지 않았습니다.'
else
  REAL_HOME=$(/usr/bin/dscl . -read "/Users/$(id -un)" NFSHomeDirectory | /usr/bin/sed 's/^NFSHomeDirectory: //')
  [ "$HOME" = "$REAL_HOME" ] && [ ! -L "$HOME" ] || fail '현재 사용자 홈 경로가 다릅니다.'
fi
verify_app() {
  local app=$1
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" = com.tamcut.aside-automation-creator ] || fail '다른 앱은 설치하지 않습니다.'
  if [ "${AAC_INSTALLER_FIXTURE:-}" = 1 ]; then
    /usr/bin/codesign --verify --deep --strict "$app"
  else
    /usr/bin/codesign --verify --deep --strict -R='anchor apple generic and identifier "com.tamcut.aside-automation-creator" and certificate leaf[subject.OU] = "9SADL7543X"' "$app"
  fi
}
verify_app "$SOURCE"
PARENT="$HOME/Applications"
DEST="$PARENT/Aside Automation Creator.app"
[ ! -L "$PARENT" ] && [ ! -L "$DEST" ] || fail '심볼릭 링크 경로에는 설치하지 않습니다.'
if [ -e "$PARENT" ]; then [ -d "$PARENT" ] && [ -O "$PARENT" ] || fail '사용자 소유 Applications 폴더가 아닙니다.'; fi
if [ -e "$DEST" ]; then
  [ -d "$DEST" ] && [ -O "$DEST" ] || fail '기존 앱의 소유권을 확인할 수 없습니다.'
  verify_app "$DEST"
  printf 'AAC_APP_PATH=%s\n' "$DEST"
  exit 0
fi
mkdir -p "$PARENT"
WORK=$(mktemp -d "$PARENT/.aac-app.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
/usr/bin/ditto "$SOURCE" "$WORK/Aside Automation Creator.app"
while IFS= read -r -d '' item; do
  if [ -L "$item" ]; then
    if /usr/bin/xattr -s "$item" | grep -qx com.apple.quarantine; then /usr/bin/xattr -s -d com.apple.quarantine "$item"; fi
    ! /usr/bin/xattr -s "$item" | grep -qx com.apple.quarantine || fail '앱 링크의 격리 속성을 제거하지 못했습니다.'
  else
    if /usr/bin/xattr "$item" | grep -qx com.apple.quarantine; then /usr/bin/xattr -d com.apple.quarantine "$item"; fi
    ! /usr/bin/xattr "$item" | grep -qx com.apple.quarantine || fail '앱의 격리 속성을 제거하지 못했습니다.'
  fi
done < <(find "$WORK" -print0)
verify_app "$WORK/Aside Automation Creator.app"
[ ! -e "$DEST" ] && [ ! -L "$DEST" ] || fail '설치 중 대상 경로가 변경됐습니다.'
mv "$WORK/Aside Automation Creator.app" "$DEST"
printf 'AAC_APP_PATH=%s\n' "$DEST"
