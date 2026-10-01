# 기여 안내

이 저장소는 「지역 현안 해결 솔루션 챌린지」 제출용 프로토타입을 관리합니다. 현재 앱은 실제 재난 대응 도구가 아니라 시연용 업무 지원 화면입니다.

## 개발 원칙

- `dist/`의 HTML, CSS, JavaScript가 배포 소스입니다. 별도 빌드 과정은 없습니다.
- 새 기능은 시연 데이터와 실제 공식 자료를 화면과 문서에서 분리해 표현합니다.
- 실제 대피 경로, 구조 우선순위, 현장 안전성을 확정하는 문구를 넣지 않습니다.
- 외부 API나 실시간 자료를 추가할 때는 출처, 이용권한, 갱신주기, 실패 시 표시 방식을 함께 기록합니다.
- 새 npm 의존성은 필요성과 대안을 검토한 뒤 추가합니다.

## 로컬 검증

```bash
npm run check
npm test
```

브라우저 확인이 필요한 변경은 `npm run dev`로 열어 데스크톱과 모바일 폭을 함께 확인합니다.

## 커밋 메시지

커밋은 Lore Commit Protocol을 따릅니다. 첫 줄은 무엇을 바꿨는지보다 왜 바꿨는지를 적습니다.

```text
Make the demo reproducible in a clean GitHub workspace

Constraint: no build step and no npm dependencies
Confidence: high
Scope-risk: narrow
Tested: npm run check; npm test
```

필요할 때만 `Constraint:`, `Rejected:`, `Directive:`, `Tested:`, `Not-tested:` 같은 꼬리표를 붙입니다.
