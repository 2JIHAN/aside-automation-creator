#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="$HOME/.local/bin:$HOME/.aside/runtime/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
MINUTE=${1:-30}
case "$MINUTE" in ''|*[!0-9]*) echo '실행 분은 0-59 정수여야 합니다.' >&2; exit 2 ;; esac
[ "$MINUTE" -le 59 ] || { echo '실행 분은 0-59여야 합니다.' >&2; exit 2; }
LABEL=io.local.routines.__AUTOMATION_SLUG__
case "$LABEL" in *'__AUTOMATION_'*) echo '템플릿 값을 먼저 확정하세요.' >&2; exit 2 ;; esac
LAUNCHER="$HOME/background/__AUTOMATION_NAME__-매시${MINUTE}분"
CONFIG=$(node - "$DIR" "$MINUTE" "$LABEL" "$LAUNCHER" <<'JS'
const [dir, minute, label, launcher] = process.argv.slice(2);
console.log(JSON.stringify({
  Label: label,
  ProgramArguments: [launcher],
  WorkingDirectory: dir,
  StartCalendarInterval: { Minute: Number(minute) },
  RunAtLoad: false,
  StandardOutPath: dir + '/runtime/runs/launchd.log',
  StandardErrorPath: dir + '/runtime/runs/launchd.log'
}));
JS
)
CONFIG=$(printf '%s\n' "$CONFIG" | /usr/bin/plutil -convert xml1 -o - -- -)
printf '%s\n' "$CONFIG" | /usr/bin/plutil -lint -- -
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
mkdir -p "$(dirname -- "$DEST")" "$(dirname -- "$LAUNCHER")" "$DIR/runtime/runs"
[ ! -L "$DEST" ] && [ ! -L "$LAUNCHER" ] || { echo '심볼릭 링크는 설치 대상으로 사용하지 않습니다.' >&2; exit 1; }
if [ -e "$LAUNCHER" ] && ! grep -Fxq '# Managed by __AUTOMATION_SLUG__' "$LAUNCHER"; then
  echo "다른 파일을 덮어쓰지 않습니다: $LAUNCHER" >&2; exit 1
fi
OLD_LAUNCHER=$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - "$DEST" 2>/dev/null || true)
if [ -e "$DEST" ]; then
  OWNER_DIR=$(/usr/bin/plutil -extract WorkingDirectory raw -o - "$DEST" 2>/dev/null || true)
  [ "$OWNER_DIR" = "$DIR" ] && [ ! -L "$OLD_LAUNCHER" ] && [ -f "$OLD_LAUNCHER" ] && grep -Fxq '# Managed by __AUTOMATION_SLUG__' "$OLD_LAUNCHER" || { echo '같은 Label의 다른 서비스는 변경하지 않습니다.' >&2; exit 1; }
elif launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo '등록 파일의 소유권을 확인하지 못한 서비스는 변경하지 않습니다.' >&2; exit 1
fi
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then launchctl bootout "$DOMAIN/$LABEL"; fi
node - "$DIR" "$LAUNCHER" <<'JS'
const fs = require('fs');
const [dir, launcher] = process.argv.slice(2);
const quoted = "'" + (dir + '/run.sh').replaceAll("'", "'\\''") + "'";
fs.writeFileSync(launcher, '#!/bin/sh\n# Managed by __AUTOMATION_SLUG__\nexec ' + quoted + ' "$@"\n', { mode: 0o755 });
fs.chmodSync(launcher, 0o755);
JS
printf '%s\n' "$CONFIG" > "$DEST"
# 생성한 실행기와 plist만 대상으로 격리 속성을 제거하고 검증한다.
for FILE in "$LAUNCHER" "$DEST"; do
  ATTRS=$(/usr/bin/xattr "$FILE")
  if printf '%s\n' "$ATTRS" | grep -qx com.apple.quarantine; then /usr/bin/xattr -d com.apple.quarantine "$FILE"; fi
  ATTRS=$(/usr/bin/xattr "$FILE")
  if printf '%s\n' "$ATTRS" | grep -qx com.apple.quarantine; then echo "격리 속성 제거 실패: $FILE" >&2; exit 1; fi
done
if [ "$OLD_LAUNCHER" != "$LAUNCHER" ]; then
  case "$OLD_LAUNCHER" in
    "$HOME/background/__AUTOMATION_NAME__-매시"*분)
      if [ ! -L "$OLD_LAUNCHER" ] && [ -f "$OLD_LAUNCHER" ] && grep -Fxq '# Managed by __AUTOMATION_SLUG__' "$OLD_LAUNCHER"; then rm -f "$OLD_LAUNCHER"; fi ;;
  esac
fi
launchctl bootstrap "$DOMAIN" "$DEST"
echo "등록 완료: $LAUNCHER / 매시 $MINUTE분. 지금 실행하지는 않습니다."
