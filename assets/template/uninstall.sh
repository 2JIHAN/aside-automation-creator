#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="$HOME/.local/bin:$HOME/.aside/runtime/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LABEL=io.local.routines.__AUTOMATION_SLUG__
case "$LABEL" in *'__AUTOMATION_'*) echo '템플릿 값을 먼저 확정하세요.' >&2; exit 2 ;; esac
DOMAIN="gui/$(id -u)"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
[ ! -L "$DEST" ] || { echo '심볼릭 링크는 제거 대상으로 사용하지 않습니다.' >&2; exit 1; }
LAUNCHER=$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - "$DEST" 2>/dev/null || true)
if [ -e "$DEST" ]; then
  OWNER_DIR=$(/usr/bin/plutil -extract WorkingDirectory raw -o - "$DEST" 2>/dev/null || true)
  [ "$OWNER_DIR" = "$DIR" ] && [ ! -L "$LAUNCHER" ] && [ -f "$LAUNCHER" ] && grep -Fxq '# Managed by __AUTOMATION_SLUG__' "$LAUNCHER" || { echo '소유권이 확인되지 않은 등록은 제거하지 않습니다.' >&2; exit 1; }
elif launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo '등록 파일의 소유권을 확인하지 못한 서비스는 제거하지 않습니다.' >&2; exit 1
fi
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL"
fi
case "$LAUNCHER" in
  "$HOME/background/__AUTOMATION_NAME__-매시"*분)
    if [ ! -L "$LAUNCHER" ] && [ -f "$LAUNCHER" ] && grep -Fxq '# Managed by __AUTOMATION_SLUG__' "$LAUNCHER"; then rm -f "$LAUNCHER"; fi ;;
esac
rm -f "$DEST"
echo '예약 해제 완료. 루틴 소스와 실행 기록은 보존했습니다.'
