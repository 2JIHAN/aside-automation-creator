#!/bin/bash
set -euo pipefail
fail() { printf '설치 중단: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 1 ] || fail '패키지 경로가 필요합니다.'
RESOURCES=$(cd "$1" && pwd -P)
[ "$(id -u)" -ne 0 ] || fail '관리자 계정으로 실행하지 마세요.'
if [ "${AAC_INSTALLER_FIXTURE:-}" = 1 ]; then
  [ -n "${AAC_FIXTURE_ROOT:-}" ] && [ -d "$AAC_FIXTURE_ROOT" ] && [ ! -L "$AAC_FIXTURE_ROOT" ] || fail '격리 테스트 경로가 필요합니다.'
  FIXTURE=$(cd "$AAC_FIXTURE_ROOT" && pwd -P)
  case "$FIXTURE" in /private/tmp/aac-macos-test.*|/tmp/aac-macos-test.*|/private/var/folders/*/aac-macos-test.*) ;; *) fail '허용되지 않은 테스트 경로입니다.' ;; esac
  [ "$HOME" = "$FIXTURE/home" ] && [ ! -L "$HOME" ] && [ "$(cd "$HOME" && pwd -P)" = "$HOME" ] && [ "${ASIDE_HOME:-}" = "$HOME/.aside" ] && [ "${ASIDE_AUTOMATION_CREATOR_REPO:-}" = "$HOME/repository" ] || fail '테스트 환경이 격리되지 않았습니다.'
else
  unset ASIDE_HOME ASIDE_AUTOMATION_CREATOR_REPO
  REAL_HOME=$(/usr/bin/dscl . -read "/Users/$(id -un)" NFSHomeDirectory | /usr/bin/sed 's/^NFSHomeDirectory: //')
  [ "$HOME" = "$REAL_HOME" ] || fail '현재 사용자 홈 경로가 다릅니다.'
  export ASIDE_HOME="$HOME/.aside"
  export ASIDE_AUTOMATION_CREATOR_REPO="$HOME/.local/share/aside-automation-creator"
fi
[ -d "$ASIDE_HOME/u" ] && [ ! -L "$ASIDE_HOME" ] && [ ! -L "$ASIDE_HOME/u" ] || fail 'Aside를 먼저 설치하고 로그인하세요.'
count=0
for profile in "$ASIDE_HOME"/u/*; do
  case "${profile##*/}" in ''|*[!0-9]*) continue ;; esac
  [ -d "$profile" ] && [ ! -L "$profile" ] && [ -O "$profile" ] || fail '현재 사용자 소유의 프로필만 지원합니다.'
  count=$((count + 1))
done
[ "$count" -gt 0 ] || fail '설치할 Aside 프로필이 없습니다.'
ARCH=x64
if [ "$(uname -m)" = arm64 ] || [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then ARCH=arm64; fi
WORK=$(mktemp -d "$ASIDE_HOME/.aac-macos.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
printf '설치 파일을 준비하고 있습니다.\n'
/bin/cp -R "$RESOURCES/payload" "$WORK/payload"
mkdir -p "$WORK/payload/runtime"
/bin/cp "$RESOURCES/runtime/$ARCH/node" "$WORK/payload/runtime/node"
clear_tree() {
  local item attrs
  while IFS= read -r -d '' item; do
    [ ! -L "$item" ] || fail '패키지에 심볼릭 링크가 있습니다.'
    attrs=$(/usr/bin/xattr "$item")
    if printf '%s\n' "$attrs" | grep -qx com.apple.quarantine; then /usr/bin/xattr -d com.apple.quarantine "$item"; fi
    ! /usr/bin/xattr "$item" | grep -qx com.apple.quarantine || fail '격리 속성을 제거하지 못했습니다.'
  done < <(find "$1" -print0)
}
clear_tree "$WORK"
if [ "${AAC_INSTALLER_FIXTURE:-}" != 1 ]; then
  /usr/bin/codesign --verify --strict -R='anchor apple generic and certificate leaf[subject.OU] = "HX7739G8FX"' "$WORK/payload/runtime/node"
fi
export PATH="$WORK/payload/runtime:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if [ ! -x "$HOME/.local/bin/aside" ]; then
  printf '공식 Aside CLI의 서명을 확인하고 있습니다.\n'
  expected=$(awk -v f="$ARCH.zip" '$2 == f {print $1}' "$RESOURCES/cli-sha256.txt")
  [ "${#expected}" -eq 64 ] && [ "$(shasum -a 256 "$RESOURCES/cli/$ARCH.zip" | awk '{print $1}')" = "$expected" ] || fail 'CLI 체크섬 검증 실패'
  /usr/bin/ditto -x -k "$RESOURCES/cli/$ARCH.zip" "$WORK/cli"
  CLI="$WORK/cli/Aside CLI.app"
  /usr/bin/codesign --verify --strict --deep -R='anchor apple generic and certificate leaf[subject.OU] = "8CPD4K4TBB"' "$CLI"
  /usr/sbin/spctl --assess --type execute "$CLI"
  [ ! -L "$HOME/.local" ] && [ ! -L "$HOME/.local/bin" ] && [ ! -L "$ASIDE_HOME/cli" ] || fail 'CLI 설치 경로가 심볼릭 링크입니다.'
  [ ! -e "$ASIDE_HOME/cli/Aside CLI.app" ] && [ ! -L "$ASIDE_HOME/cli/Aside CLI.app" ] && [ ! -e "$HOME/.local/bin/aside" ] && [ ! -L "$HOME/.local/bin/aside" ] || fail '기존 CLI 경로를 덮어쓰지 않습니다.'
  mkdir -p "$ASIDE_HOME/cli" "$HOME/.local/bin"
  /usr/bin/ditto "$CLI" "$ASIDE_HOME/cli/Aside CLI.app"
  clear_tree "$ASIDE_HOME/cli/Aside CLI.app"
  /usr/bin/codesign --verify --strict --deep -R='anchor apple generic and certificate leaf[subject.OU] = "8CPD4K4TBB"' "$ASIDE_HOME/cli/Aside CLI.app"
  ln -s "$ASIDE_HOME/cli/Aside CLI.app/Contents/MacOS/aside" "$HOME/.local/bin/aside"
  if /usr/bin/xattr -s "$HOME/.local/bin/aside" | grep -qx com.apple.quarantine; then /usr/bin/xattr -s -d com.apple.quarantine "$HOME/.local/bin/aside"; fi
  ! /usr/bin/xattr -s "$HOME/.local/bin/aside" | grep -qx com.apple.quarantine || fail 'CLI 링크 격리 속성 제거에 실패했습니다.'
fi
printf '스킬과 공용 엔진을 설치하고 있습니다.\n'
/bin/bash "$WORK/payload/install-to-aside.sh" --source-directory "$WORK/payload"
[ -f "$ASIDE_AUTOMATION_CREATOR_REPO/.aside-automation-creator-package" ] || fail '설치 확인 파일이 없습니다.'
cmp "$WORK/payload/engine.mjs" "$ASIDE_AUTOMATION_CREATOR_REPO/engine.mjs" || fail '공용 엔진 설치 확인에 실패했습니다.'
for profile in "$ASIDE_HOME"/u/*; do
  case "${profile##*/}" in ''|*[!0-9]*) continue ;; esac
  cmp "$WORK/payload/SKILL.md" "$profile/skills/user/aside-automation-creator/SKILL.md" || fail '스킬 설치 확인에 실패했습니다.'
done
cmp "$WORK/payload/runtime/node" "$ASIDE_AUTOMATION_CREATOR_REPO/runtime/node" || fail 'Node 설치 확인에 실패했습니다.'
printf 'AAC_INSTALL_COMPLETE\n'
