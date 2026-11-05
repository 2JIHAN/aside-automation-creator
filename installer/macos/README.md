# macOS 앱 업데이트 배포

공개한 앱은 메뉴 막대에서 실행되며 Sparkle로 업데이트를 확인합니다. 앱 교체 후 새 앱이 기존 설치기를 실행해 공용 엔진과 제작 스킬을 적용합니다. 업무 폴더와 예약은 변경하지 않습니다.

## 빌드와 공증

Developer ID 인증서와 Apple 공증 자격 증명을 준비합니다. Sparkle 2.10.1은 빌드 시 고정 체크섬으로 검증합니다. 이미 검증한 배포본을 사용하려면 `SPARKLE_DISTRIBUTION_DIR`로 지정합니다.

```sh
CODE_SIGN_IDENTITY='Developer ID Application: YOUR NAME (TEAMID)' \
  bash installer/macos/build.sh --build /absolute/output 0.3.1
xcrun notarytool submit /absolute/output/AsideAutomationCreator-0.3.1-macOS.zip \
  --keychain-profile YOUR_PROFILE --wait
xcrun stapler staple '/absolute/output/Aside Automation Creator.app'
spctl --assess --type execute '/absolute/output/Aside Automation Creator.app'
```

현재 앱 영구 설치기는 이 프로젝트의 Developer ID 팀을 검증합니다. 다른 팀으로 배포하려면 `adopt-app.sh`와 `prepare-update.sh`의 서명 요구사항도 함께 변경합니다.

## 업데이트 파일 만들기

Sparkle 키는 로그인 키체인의 `aside-automation-creator` 계정을 사용합니다. 공개 키는 `sparkle-public-key.txt`에 있습니다. 개인 키를 저장소나 릴리즈에 넣지 않습니다. 최초 배포 후 키를 바꾸면 기존 앱과의 업데이트 호환성을 별도로 확인합니다.

```sh
SPARKLE_DISTRIBUTION_DIR=/absolute/Sparkle \
  bash installer/macos/prepare-update.sh /absolute/output 0.3.2 \
    /absolute/previous/AsideAutomationCreator-0.3.1-macOS.zip
```

이 명령은 공증과 버전, 서명 키를 검사하고 ZIP 및 서명된 업데이트 항목이 들어 있는 `appcast.xml`을 만듭니다. 이전 ZIP을 함께 넘기면 가능한 경우 차등 업데이트 파일도 만듭니다. 생성된 `.delta` 파일도 새 릴리즈에 올립니다. 공개 배포는 수행하지 않습니다.

페이로드 지문은 엔진과 SKILL.md, 실제 템플릿 및 Node에 한정합니다. 앱 UI와 문서, 장식 이미지는 재설치 여부를 바꾸지 않습니다. 패키지 갱신은 내용이 같은 파일을 건너뛰고 변경된 기존 파일만 백업합니다. Git 소스를 패키지로 처음 전환할 때만 기존 Git 저장소 전체를 보존합니다.

1. ZIP과 공증된 DMG를 해당 GitHub 릴리즈에 올립니다.
2. GitHub에서 파일을 다시 받아 SHA256과 서명을 확인합니다.
3. 생성한 `appcast.xml`을 이 폴더에 복사하고 `main`에 반영합니다.
4. 이전 앱에서 업데이트 확인과 설치, 재실행을 검증합니다.

앱의 피드 주소는 `main/installer/macos/appcast.xml`입니다. 다운로드 파일을 먼저 공개하고 피드를 나중에 반영합니다. 피드만 먼저 올리면 사용자 앱이 아직 없는 파일을 내려받으려 할 수 있습니다.

CI가 만드는 macOS 앱은 개발용 임시 서명입니다. 공개된 릴리즈의 파일을 CI 출력으로 덮어쓰지 않습니다. Developer ID 서명과 공증을 통과한 파일만 업데이트 피드에 연결합니다.

## 확인 범위

다음 명령은 가짜 CLI와 격리된 홈을 사용하는 설치 테스트 및 컴파일한 Swift 상태 정책 테스트를 실행합니다.

```sh
ASIDE_AUTOMATION_CREATOR_REPO="$PWD" node --test \
  assets/template/tests/scenario.test.mjs tests/install-to-aside.test.mjs tests/macos-*.test.mjs
```

첫 설치, 로그인 실행 등록, 메뉴 표시, 이전 앱에서 새 앱으로의 실제 업데이트는 macOS에서 별도로 확인합니다. 자동 설치 옵션은 기본으로 꺼져 있고 자동 확인은 하루 간격입니다. 앱을 종료하면 자동 확인도 멈춥니다.

기존 설치 앱의 서명이 손상돼 설치가 거부되면 해당 앱을 별도 위치로 옮긴 뒤 정상 서명의 DMG에서 다시 설치합니다. 업무 폴더나 예약 설정을 지울 필요는 없습니다.
