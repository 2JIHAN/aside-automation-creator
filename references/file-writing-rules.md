# 파일 작성 규약

## 기본 구조

맞는 유형이 없으면 `assets/scenarios/basic/template/`에서 시작합니다. 기본형은 작은 파일 목록 보고서 업무를 예로 들어 검토, 알림, 자원 정리와 학습을 연결합니다. 다른 유형을 고르면 그 유형의 파일과 스텝을 사용합니다.

OS에 맞는 실행기와 설치 및 해제 스크립트를 한 세트로 선택합니다. 먼저 수동으로 검증하고 예약이 필요하면 주기와 등록 승인을 받은 뒤 설치합니다. 기본 설치 스크립트는 매시 지정 분 실행의 예시이며 다른 일정은 별도로 작성하고 검증합니다.

```text
<scenario>/
├── README.md
├── run.sh 또는 run.ps1
├── workflow/
│   ├── context.md
│   ├── flow.json
│   ├── memory.md
│   └── steps/
│       ├── work.md
│       ├── review.md
│       ├── notify.md
│       ├── cleanup.md
│       └── learn.md
├── maintenance/
│   ├── install.sh 또는 install.ps1
│   ├── uninstall.sh 또는 uninstall.ps1
│   └── tests/
│       ├── 010-normal-flow.test.mjs
│       ├── 020-review-recovery.test.mjs
│       ├── 030-notify-idempotency.test.mjs
│       ├── 040-cleanup-learning.test.mjs
│       ├── 050-account-selection.test.mjs
│       ├── 060-installation.test.mjs
│       ├── 070-workflow-contract.test.mjs
│       └── test-helpers.mjs
└── runs/                         실행과 예약에서 생성
    ├── launchd.log               macOS 예약 로그
    └── <execution-id>/
        ├── run.json
        └── evidence/
            └── <turn>-<step>/
                └── <evidence-files>
```

기본형의 공통 기능이 모든 업무의 필수 권한을 뜻하지는 않습니다. 실제로 필요하고 허용된 범위에 맞춰 구성하고 단계나 상태를 바꾸면 테스트도 함께 맞춥니다.

## 파일 간 연결 규칙

- 공통 엔진을 사용합니다. 시나리오에 엔진 사본, Git 저장소나 `.gitignore`를 만들지 않습니다. 새 자동화는 `~/aside-automations/<slug>`에 만들고 기존 자동화의 경로는 유지합니다.
- `contextFile`과 `instructionFile`은 시나리오 기준 상대경로로 적고 실제 파일과 맞춥니다. `startStep`과 이동 규칙의 `step`은 파일명이 아니라 `steps`에 선언한 단계 ID를 가리킵니다.
- `initialState`에 `현재턴결과`와 필요한 상태를 선언합니다. `stateKey`와 `when`에서 쓰는 상태 키도 여기에 포함합니다. 단계 MD가 보고할 값과 `flow.json`의 기대값을 맞춥니다. 응답 값은 문자열이며 `현재턴결과`와 해당 `stateKey`에 반영됩니다.
- `when`은 값과 자료형이 같은지 비교합니다. 조건이 여러 개면 모두 일치해야 합니다. 결과마다 규칙 하나만 일치하도록 작성합니다. 빈 조건은 항상 일치하므로 다른 규칙과 겹치지 않게 합니다.
- 이동 규칙에는 `step` 또는 문자열 `finishWithStatus` 중 하나만 지정합니다. `$caller`는 `rememberCaller`로 기록한 출발 단계로만 복귀하며, 복귀를 중첩하지 않습니다. 같은 업무로 재확인하러 돌아가는 횟수는 두 번까지입니다.
- 여러 실행에서 함께 쓰는 상태 장부는 `runs/` 밖에 둡니다. 공통 엔진 테스트는 제작 저장소의 `tests/engine/`에, 업무별 테스트는 시나리오의 `maintenance/tests/`에 둡니다.
- 테스트 파일은 행동별로 나누고 각각 독립적인 임시 환경을 사용합니다. 파일 번호대로 실행될 것이라고 가정하지 않습니다. `test-helpers.mjs`에는 공통 준비 코드를 두고, 입력과 기대 결과는 각 테스트에서 바로 볼 수 있게 작성합니다.
