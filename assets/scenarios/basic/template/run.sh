#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
export PATH="$HOME/.local/bin:$HOME/.aside/runtime/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TZ=__TIMEZONE__
ENGINE_REPO=${ASIDE_AUTOMATION_CREATOR_REPO:-"$HOME/.local/share/aside-automation-creator"}
NODE=${ASIDE_NODE_PATH:-$(command -v node || true)}
NODE=${NODE:-"$ENGINE_REPO/runtime/node"}
export ASIDE_CLI_PATH=${ASIDE_CLI_PATH:-"$HOME/.local/bin/aside"}
cd "$DIR"
[ "$#" -eq 0 ] || { echo '사용법: ./run.sh' >&2; exit 2; }

FLOW=$("$NODE" -e 'const fs=require("fs"),path=require("path");const root=fs.realpathSync(process.cwd()),modeFile=path.join(root,"workflow/mode.json");if(!fs.lstatSync(modeFile).isFile())process.exit(1);const m=JSON.parse(fs.readFileSync(modeFile,"utf8"));const f=m.flows&&Object.hasOwn(m.flows,m.mode)&&m.flows[m.mode];if(typeof f!=="string"||!f)process.exit(1);const requested=path.resolve(root,f),real=fs.realpathSync(requested);if(!real.startsWith(root+path.sep)||!fs.lstatSync(requested).isFile())process.exit(1);console.log(f)' 2>/dev/null) || { echo 'workflow/mode.json에서 유효한 흐름 파일을 찾지 못했습니다.' >&2; exit 2; }

[ ! -L runs ] || { echo '실행 기록 폴더의 심볼릭 링크를 따라가지 않습니다.' >&2; exit 4; }
mkdir -p runs
LOCK="$DIR/runs/.run.lock"
mkdir "$LOCK" 2>/dev/null || { echo "이미 실행 중이거나 잠금이 남아 있습니다: $LOCK" >&2; exit 4; }
# 내가 만든 잠금만 해제하고 다른 실행이나 오래된 잠금은 보존한다.
trap 'if [ ! -L "$LOCK" ] && [ -f "$LOCK/pid" ] && [ ! -L "$LOCK/pid" ] && [ "$(cat "$LOCK/pid")" = "$$" ]; then rm -f "$LOCK/pid"; rmdir "$LOCK"; fi' EXIT
trap 'exit 143' HUP INT TERM
echo "$$" > "$LOCK/pid"

ACCOUNTS=$("$ASIDE_CLI_PATH" account list)
ACCOUNT=$(printf '%s\n' "$ACCOUNTS" | awk -v email='__ACCOUNT_EMAIL__' '
  { for (i=1; i<NF; i++) if ($i ~ /^u[0-9]+$/ && tolower($(i+1)) == tolower(email)) { id=$i; count++ } }
  END {
    if (count != 1) { print "실행 계정을 유일하게 찾지 못했습니다." > "/dev/stderr"; exit 1 }
    print id
  }
')
"$NODE" "$ENGINE_REPO/engine.mjs" "$ACCOUNT" "$DIR" "$FLOW"
