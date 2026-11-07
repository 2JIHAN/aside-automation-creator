# __AUTOMATION_NAME__

__WORKFLOW_GOAL__

## 실행 전 확인

`workflow/context.md`에서 대상, 실행 계정과 허용된 작업을 확인합니다. 업무 단계와 알림 수신자에 남은 자리표시자를 실제 확인한 값으로 바꿉니다. `workflow/flow.json`이 사용자와 합의한 흐름인지 확인하고 모의 검사와 승인받은 실제 실행을 구분해 기록합니다.

## 직접 실행

macOS에서는 `./run.sh`, Windows에서는 `.\run.ps1`을 사용합니다. 실행 계정은 `__ACCOUNT_EMAIL__`이며 시간대는 `__TIMEZONE__`입니다. 공통 엔진은 AAC 설치본을 사용합니다.

## 예약

예약 등록 승인을 받은 뒤 선택한 OS의 `maintenance/install.sh` 또는 `maintenance/install.ps1`을 실행합니다. 기본 설치 예시는 매시 30분 실행이며 호스트의 시간대를 따릅니다. 다른 일정은 설치 스크립트를 맞춰 작성하고 실제 등록 값을 확인합니다. 해제는 같은 OS의 `maintenance/uninstall.sh` 또는 `maintenance/uninstall.ps1`을 사용합니다.

## 검사와 기록

모의 검사는 `node --test maintenance/tests/*.test.mjs`로 수행합니다. 실제 업무는 가짜 CLI 검사로 검증되지 않습니다. 실행 결과와 증거는 `runs/`, 학습을 허용한 경우의 메모리는 `workflow/memory.md`에 보관합니다. 실제 검증 결과와 남은 확인 사항을 이 문서에 적습니다.
