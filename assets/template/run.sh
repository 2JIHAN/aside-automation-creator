#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="$HOME/.local/bin:$HOME/.aside/runtime/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TZ=__TIMEZONE__
NODE=$(command -v node)
cd "$DIR"
# 실행 옵션은 없다. 없앤 옵션을 넘겨 실제 작업이 시작되는 것은 막는다.
[ "$#" -eq 0 ] || { echo '사용법: ./run.sh' >&2; exit 2; }

ACCOUNTS=$("$HOME/.local/bin/aside" account list)
ACCOUNT=$(printf '%s\n' "$ACCOUNTS" | awk -v email='__ACCOUNT_EMAIL__' '
  { for (i=1; i<NF; i++) if ($i ~ /^u[0-9]+$/ && tolower($(i+1)) == tolower(email)) { id=$i; count++ } }
  END {
    if (count != 1) { print "실행 계정을 유일하게 찾지 못했습니다." > "/dev/stderr"; exit 1 }
    print id
  }
')
"$NODE" "$DIR/src/engine.mjs" "$ACCOUNT"
