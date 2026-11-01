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

check_source() {
  local source="$1"
  [ -f "$source/SKILL.md" ] && [ ! -L "$source/SKILL.md" ] && [ -d "$source/assets" ] || fail '스킬 파일과 assets가 없습니다.'
  [ -f "$source/engine.mjs" ] && [ ! -L "$source/engine.mjs" ] || fail '공통 엔진이 없습니다.'
  [ -z "$(find "$source/assets" -type l -print -quit)" ] || fail '템플릿의 심볼릭 링크는 설치하지 않습니다.'
  grep -Fxq 'name: "aside-automation-creator"' "$source/SKILL.md" || fail '스킬 이름이 다릅니다.'
}

main() {
  local source_directory=''
  if [ "$#" -ne 0 ]; then
    [ "$#" -eq 2 ] && [ "$1" = --source-directory ] || fail '사용법: install-to-aside.sh [--source-directory PAYLOAD]'
    source_directory="$2"
    [ -d "$source_directory" ] && [ ! -L "$source_directory" ] || fail '패키지 폴더가 없거나 심볼릭 링크입니다.'
    [ -z "$(find "$source_directory" -type l -print -quit)" ] || fail '패키지의 심볼릭 링크는 설치하지 않습니다.'
    source_directory=$(cd "$source_directory" && pwd -P)
    check_source "$source_directory"
    for file in README.md install-to-aside.sh runtime/node; do
      [ -f "$source_directory/$file" ] || fail "패키지 파일이 없습니다: $file"
    done
    [ -x "$source_directory/runtime/node" ] || fail '패키지 Node 실행 권한이 없습니다.'
  else
    command -v git >/dev/null || fail 'Git이 필요합니다.'
  fi
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
    for parent in "$account/skills" "$account/skills/user"; do
      [ ! -L "$parent" ] || fail "스킬 경로가 심볼릭 링크입니다: $parent"
      [ ! -e "$parent" ] || [ -d "$parent" ] || fail "스킬 경로가 폴더가 아닙니다: $parent"
    done
    accounts+=("$account")
  done
  [ "${#accounts[@]}" -gt 0 ] || fail '설치할 Aside 계정이 없습니다.'
  [ ! -L "$REPO" ] || fail "저장소 경로가 심볼릭 링크입니다: $REPO"
  # 기존 폴더도 상위 경로 전체를 확인한다. macOS의 시스템 별칭만 허용한다.
  parent=$(dirname "$REPO")
  while [ "$parent" != / ] && [ "$parent" != . ]; do
    if [ -L "$parent" ]; then
      case "$parent:$(readlink "$parent")" in
        /var:private/var|/var:/private/var|/tmp:private/tmp|/tmp:/private/tmp)
          [ "$(uname -s)" = Darwin ] || fail "저장소 상위 경로가 심볼릭 링크입니다: $parent" ;;
        *) fail "저장소 상위 경로가 심볼릭 링크입니다: $parent" ;;
      esac
    fi
    parent=$(dirname "$parent")
  done
  ensure_dir "$(dirname "$REPO")"
  WORKDIR=$(mktemp -d "$ASIDE_HOME/.automation-creator-install.XXXXXX")
  trap 'rm -rf -- "$WORKDIR"' EXIT
  clear_one "$WORKDIR"
  touch "$WORKDIR/start"
  clear_one "$WORKDIR/start"

  if [ -n "$source_directory" ]; then
    if [ -e "$REPO" ]; then
      if [ -f "$REPO/.aside-automation-creator-package" ] && [ ! -L "$REPO/.aside-automation-creator-package" ] && grep -Fxq "$URL" "$REPO/.aside-automation-creator-package"; then
        :
      elif [ -d "$REPO/.git" ] && [ ! -L "$REPO/.git" ] && [ -f "$REPO/.git/config" ] && [ ! -L "$REPO/.git/config" ] && awk -v url="$URL" '
        /^\[/{origin=($0 == "[remote \"origin\"]")}
        origin && $1 == "url" && $2 == "=" && $3 == url {found=1}
        END {exit !found}
      ' "$REPO/.git/config"; then
        :
      else
        fail "다른 폴더 또는 원본 저장소 주소가 다른 폴더를 덮어쓰지 않습니다: $REPO"
      fi
    fi
    local fresh="$WORKDIR/repository" repo_backup=''
    mkdir "$fresh"
    for file in SKILL.md engine.mjs README.md install-to-aside.sh assets runtime; do cp -R "$source_directory/$file" "$fresh/"; done
    printf '%s\n' "$URL" > "$fresh/.aside-automation-creator-package"
    clear_tree "$fresh"
    check_source "$fresh"
    if [ -e "$REPO" ]; then
      repo_backup="$REPO.backup-$(date +%Y%m%d-%H%M%S)-$"
      [ ! -e "$repo_backup" ] && [ ! -L "$repo_backup" ] || fail "백업 경로가 이미 있습니다: $repo_backup"
      mv "$REPO" "$repo_backup"
    fi
    if ! mv "$fresh" "$REPO"; then
      if [ -n "$repo_backup" ] && [ ! -e "$REPO" ] && [ ! -L "$REPO" ]; then mv "$repo_backup" "$REPO"; fi
      fail '새 저장소 배치 실패. 기존 저장소를 복원했습니다.'
    fi
    if [ -n "$repo_backup" ]; then printf '기존 패키지 저장소 백업: %s\n' "$repo_backup"; fi
  elif [ -e "$REPO" ]; then
    [ -d "$REPO/.git" ] || fail "다른 폴더를 덮어쓰지 않습니다: $REPO"
    [ "$(git -C "$REPO" remote get-url origin)" = "$URL" ] || fail '원본 저장소 주소가 다릅니다.'
    [ "$(git -C "$REPO" symbolic-ref --short HEAD)" = main ] || fail 'main 브랜치가 아닙니다.'
    if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
      local fresh="$WORKDIR/repository" repo_backup="$REPO.backup-$(date +%Y%m%d-%H%M%S)-$$"
      [ ! -e "$repo_backup" ] && [ ! -L "$repo_backup" ] || fail "백업 경로가 이미 있습니다: $repo_backup"
      git clone --branch main --single-branch "$URL" "$fresh"
      clear_tree "$fresh"
      check_source "$fresh"
      mv "$REPO" "$repo_backup"
      if ! mv "$fresh" "$REPO"; then
        [ ! -e "$REPO" ] && [ ! -L "$REPO" ] || fail "새 저장소 배치 실패. 원본 백업: $repo_backup"
        mv "$repo_backup" "$REPO"
        fail '새 저장소를 배치하지 못해 기존 저장소를 복원했습니다.'
      fi
      printf '로컬 수정 저장소 백업: %s\n' "$repo_backup"
    else
      git -C "$REPO" pull --ff-only
    fi
  else
    git clone --branch main --single-branch "$URL" "$REPO"
  fi
  # 이번 Git 작업이 생성하거나 수정한 항목만 정리한다.
  local file
  find "$REPO" -newer "$WORKDIR/start" -print0 | while IFS= read -r -d '' file; do clear_one "$file"; done
  check_source "$REPO"

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
