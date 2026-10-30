#!/bin/bash
set -euo pipefail

fail() { printf '설치 중단: %s\n' "$*" >&2; exit 1; }

clear_one() {
  [ "$(uname -s)" = Darwin ] || return 0
  local file="$1" attrs mode='' code=0
  if [ -L "$file" ]; then
    attrs=$(/usr/bin/xattr -s "$file")
    if printf '%s\n' "$attrs" | grep -qx com.apple.quarantine; then /usr/bin/xattr -s -d com.apple.quarantine "$file"; fi
    attrs=$(/usr/bin/xattr -s "$file")
  else
    attrs=$(/usr/bin/xattr "$file")
    if printf '%s\n' "$attrs" | grep -qx com.apple.quarantine; then
      if [ ! -w "$file" ]; then mode=$(/usr/bin/stat -f '%Lp' "$file"); chmod u+w "$file"; fi
      /usr/bin/xattr -d com.apple.quarantine "$file" || code=$?
      if [ -n "$mode" ]; then chmod "$mode" "$file"; fi
      [ "$code" -eq 0 ] || return "$code"
    fi
    attrs=$(/usr/bin/xattr "$file")
  fi
  if printf '%s\n' "$attrs" | grep -qx com.apple.quarantine; then fail "격리 속성 제거 실패: $file"; fi
}

ensure_dir() {
  [ ! -L "$1" ] || fail "심볼릭 링크 폴더에는 설치하지 않습니다: $1"
  if [ ! -d "$1" ]; then
    ensure_dir "$(dirname "$1")"
    mkdir "$1"
    clear_one "$1"
  fi
}

clear_tree() {
  local file
  find "$1" -print0 | while IFS= read -r -d '' file; do clear_one "$file"; done
}

main() {
  [ "$#" -eq 0 ] || fail '인수 없이 실행하세요.'
  command -v git >/dev/null || fail 'Git이 필요합니다.'
  ASIDE_HOME=${ASIDE_HOME:-"$HOME/.aside"}
  REPO=${ASIDE_AUTOMATION_CREATOR_REPO:-"$HOME/.local/share/aside-automation-creator"}
  URL=https://github.com/2JIHAN/aside-automation-creator.git
  [ -d "$ASIDE_HOME/u" ] || fail "Aside 계정 폴더가 없습니다: $ASIDE_HOME/u"
  [ ! -L "$ASIDE_HOME" ] && [ ! -L "$ASIDE_HOME/u" ] || fail 'Aside 계정 경로가 심볼릭 링크입니다.'

  local accounts=() account number parent
  for account in "$ASIDE_HOME"/u/*; do
    number=${account##*/}
    case "$number" in ''|*[!0-9]*) continue ;; esac
    [ ! -L "$account" ] || fail "계정 경로가 심볼릭 링크입니다: $account"
    [ -d "$account" ] || continue
    for parent in "$account/skills" "$account/skills/user"; do [ ! -L "$parent" ] || fail "스킬 경로가 심볼릭 링크입니다: $parent"; done
    accounts+=("$account")
  done
  [ "${#accounts[@]}" -gt 0 ] || fail '설치할 Aside 계정이 없습니다.'
  [ ! -L "$REPO" ] || fail "저장소 경로가 심볼릭 링크입니다: $REPO"
  ensure_dir "$(dirname "$REPO")"
  WORKDIR=$(mktemp -d "$ASIDE_HOME/.automation-creator-install.XXXXXX")
  trap 'rm -rf -- "$WORKDIR"' EXIT
  clear_one "$WORKDIR"
  touch "$WORKDIR/start"
  clear_one "$WORKDIR/start"

  if [ -e "$REPO" ]; then
    [ -d "$REPO/.git" ] || fail "다른 폴더를 덮어쓰지 않습니다: $REPO"
    [ "$(git -C "$REPO" remote get-url origin)" = "$URL" ] || fail '원본 저장소 주소가 다릅니다.'
    [ "$(git -C "$REPO" symbolic-ref --short HEAD)" = main ] || fail 'main 브랜치가 아닙니다.'
    [ -z "$(git -C "$REPO" status --porcelain)" ] || fail '공용 저장소에 로컬 변경이 있습니다. 먼저 보존하거나 커밋하세요.'
    git -C "$REPO" pull --ff-only
  else
    git clone --branch main --single-branch "$URL" "$REPO"
  fi
  # 이번 Git 작업이 생성하거나 수정한 항목만 정리한다.
  local file
  find "$REPO" -newer "$WORKDIR/start" -print0 | while IFS= read -r -d '' file; do clear_one "$file"; done
  [ -f "$REPO/SKILL.md" ] && [ ! -L "$REPO/SKILL.md" ] && [ -d "$REPO/assets" ] || fail '스킬 파일과 assets가 없습니다.'
  [ -z "$(find "$REPO/assets" -type l -print -quit)" ] || fail '템플릿의 심볼릭 링크는 설치하지 않습니다.'
  grep -Fxq 'name: "aside-automation-creator"' "$REPO/SKILL.md" || fail '스킬 이름이 다릅니다.'

  local stage="$WORKDIR/skill" dest prepared backup='' installed=0 unchanged=0
  mkdir "$stage"
  cp "$REPO/SKILL.md" "$stage/"
  cp -R "$REPO/assets" "$stage/"
  clear_tree "$stage"
  local backup_root="$ASIDE_HOME/skill-backups/aside-automation-creator/$(date +%Y%m%d-%H%M%S)-$$"
  for account in "${accounts[@]}"; do
    number=${account##*/}
    dest="$account/skills/user/aside-automation-creator"
    if [ -d "$dest" ] && [ ! -L "$dest" ] && [ -z "$(find "$dest" -type l -print -quit)" ] && diff -qr "$stage" "$dest" >/dev/null 2>&1; then
      printf 'u%s: 이미 최신입니다.\n' "$number"
      unchanged=$((unchanged + 1))
      continue
    fi
    ensure_dir "$account/skills/user"
    prepared="$WORKDIR/profile-$number"
    cp -R "$stage" "$prepared"
    clear_tree "$prepared"
    backup=''
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      ensure_dir "$backup_root"
      backup="$backup_root/u$number"
      mv "$dest" "$backup"
    fi
    if ! mv "$prepared" "$dest"; then
      if [ -n "$backup" ]; then mv "$backup" "$dest"; fi
      fail "프로필 설치 실패: u$number"
    fi
    printf 'u%s: 설치 완료: %s\n' "$number" "$dest"
    if [ -n "$backup" ]; then printf '  이전 버전 백업: %s\n' "$backup"; fi
    installed=$((installed + 1))
  done
  printf '\n완료: 설치/업데이트 %s개, 이미 최신 %s개. 새 Aside 채팅에서 사용하세요.\n' "$installed" "$unchanged"
  printf '공용 소스: %s\n' "$REPO"
}

main "$@"
