# aside-automation-creator

사용자와 실제 작업을 함께 따라가며 배운 절차를, 반복 실행할 수 있는 Aside 자동화 폴더로 만드는 Agent Skill입니다.

요청을 처음부터 JSON으로 작성할 필요는 없습니다. 평소처럼 작업을 보여주고 목표와 예외 대응을 정하면, 에이전트가 단계 지침과 실행 흐름을 작성합니다. 기본 생성 위치는 `~/aside-automations/<slug>/`입니다.

## 설치

Node.js 22.20 이상에서 실행합니다.

```sh
npx skills add 2JIHAN/aside-automation-creator
```

특정 도구의 전체 프로젝트에서 사용하려면 대상을 지정합니다.

```sh
# Claude Code
npx skills add 2JIHAN/aside-automation-creator -g -a claude-code

# Codex
npx skills add 2JIHAN/aside-automation-creator -g -a codex
```

설치 가능한 스킬만 확인하려면:

```sh
npx skills add 2JIHAN/aside-automation-creator --list
```

`skills` 설치와 자동화 실행은 별개입니다. 이 스킬을 설치해도 브라우저 작업이나 트리거가 자동 실행되지 않습니다.

### Aside 프로필에 설치

현재 `skills` CLI의 지원 에이전트 목록에는 Aside가 없습니다. 위 명령이 Aside 프로필 경로에 설치한다고 가정하지 마세요. Aside에서는 저장소의 `SKILL.md`와 `assets/`를 선택한 계정의 커스텀 스킬 폴더에 복사합니다.

```sh
# aside account list에서 대상 계정을 확인한 뒤 지정합니다.
ASIDE_ACCOUNT=u0
SOURCE=$(mktemp -d)
DEST="$HOME/.aside/$ASIDE_ACCOUNT/skills/user/aside-automation-creator"

git clone https://github.com/2JIHAN/aside-automation-creator.git "$SOURCE/repo"
test ! -e "$DEST" || { echo "기존 스킬이 있습니다: $DEST"; exit 1; }
mkdir -p "$DEST"
cp "$SOURCE/repo/SKILL.md" "$DEST/"
cp -R "$SOURCE/repo/assets" "$DEST/"
```

기존 스킬을 업데이트할 때는 먼저 변경 내용을 비교하세요. Aside에서 파일을 생성하거나 복사했다면 사용 중인 격리 속성 처리 지침에 따라 해당 파일만 정리한 뒤 사용합니다.

## 사용 예시

```text
aside-automation-creator로 이 업무를 함께 따라가면서 자동화 만들어줘.
우선 정상적인 처리 순서를 보여줄게. 이후 매시간 20분에 실행하고 싶어.
```

스킬은 다음 순서로 작업합니다.

1. 실제 작업에서 대상과 판단 기준을 확인합니다.
2. 계정, 변경 권한, 성공 조건, 예외 정책, 알림 대상과 트리거를 정합니다.
3. 관찰한 절차를 flow와 단계 지침으로 작성합니다.
4. 가짜 CLI 테스트로 분기와 기록을 검증합니다.
5. 승인된 경우에만 실제 작업을 실행하고 트리거를 등록합니다.

## 생성하는 구조

```text
~/aside-automations/<slug>/
├─ README.md
├─ run.sh
├─ install.sh
├─ uninstall.sh
├─ src/engine.mjs
├─ tests/scenario.test.mjs
├─ workflow/
│  ├─ flow.json
│  ├─ context.md
│  └─ steps/*.md
└─ runtime/runs/
```

템플릿의 `work.md`는 최소 예시입니다. 실제 업무가 여러 단계라면 그에 맞게 나눕니다. `__ACCOUNT_EMAIL__`, `__TIMEZONE__`, 자동화 이름과 업무 대상 등의 자리표시자는 에이전트가 확정한 정보로 채웁니다.

## 실행 환경과 범위

- 자동화 실행에는 로그인된 Aside CLI가 필요합니다. 기본 실행 경로는 `~/.local/bin/aside`입니다.
- 실행 계정은 현재 CLI 계정 목록에서 이메일로 찾습니다. 고정된 `u0`, `u1` 번호에 의존하지 않습니다.
- 제공된 설치와 해제 스크립트는 macOS LaunchAgent의 매시 지정 분 실행 예시입니다.
- 스케줄은 호스트 시스템 시간대를 따릅니다. `run.sh`의 `TZ`는 작업과 보고의 시간대입니다.
- 웹훅, 파일 변경 등의 다른 트리거는 요청된 환경에서 가능한 수단을 확인한 뒤 별도로 연결합니다.
- 스킬 설치만으로 Aside나 Node.js, 인증 정보를 설치하지 않습니다.

## 엔진의 계약

`initialState`에 보관할 상태와 `현재턴결과`를 선언합니다. 매 단계의 마지막 응답은 `상태: 값`이며, 엔진이 현재턴결과를 갱신합니다. `stateKey`가 있는 단계는 해당 상태도 함께 갱신합니다.

분기는 `when`에서 선언된 값의 일치와 AND로 판단합니다. 정확히 하나의 규칙이 맞아야 하며, 규칙은 다음 `step` 또는 `finishWithStatus` 중 하나를 지정합니다. 별도의 종료 스텝은 필요하지 않습니다.

공통 검토 단계는 `$caller`로 원래 업무에 복귀할 수 있습니다. 같은 업무로의 재확인은 실행당 최대 2회이며, 한도에 도달하면 해결불가 경로로 진행합니다.

기본 종료 상태는 `ok`, `handed_off`, `incomplete`, `stopped`입니다. `handed_off`는 문제를 지정한 대상에게 전달하고 정리를 마쳤다는 뜻이며, 수신자가 읽거나 해결했다는 뜻은 아닙니다.

현재 엔진은 종료 시 `run.json`을 한 번 저장합니다. 강제 종료나 무응답에서는 최종 기록과 탭 정리를 보장하지 않습니다. 모의 테스트는 실제 화면 판독이나 외부 전송의 성공을 보장하지 않습니다.

## 템플릿 검증

브라우저나 실제 트리거를 실행하지 않고 가짜 CLI와 임시 HOME으로 검사합니다.

```sh
node --test assets/template/tests/scenario.test.mjs
```

정상, 복구, 문제 인계, 재확인 한도, 알림과 정리 실패, 계정 확인, 설치와 재설치 및 제거, 기존 서비스 소유권 충돌을 검사합니다.

## 관련 문서

- [Agent Skills 표준](https://agentskills.io/)
- [skills CLI](https://github.com/vercel-labs/skills)

라이선스는 아직 지정하지 않았습니다.
