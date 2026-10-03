# 운산 연결지도

서산시 운산면 원평리·고풍리 주변을 배경으로 만든 호우 대응 업무지원 프로토타입입니다. 한 명의 호우 비상근무 담당자가 마을별 연결 상태, 도로 통제, 대피시설 개방 여부, 현장 확인 기록을 같은 화면에서 대조하는 흐름을 시연합니다.

[![CI](https://github.com/LSB-afk/Challenge-for-Solutions-to-Local-Issues/actions/workflows/ci.yml/badge.svg)](https://github.com/LSB-afk/Challenge-for-Solutions-to-Local-Issues/actions/workflows/ci.yml)

현재 앱은 공모전 제출용 데모입니다. 배경지도·지형·공개 건물 윤곽을 제외한 마을 구획, 도로 선형, 시설 위치, 통제 상태, 영향 범위는 모두 시연 데이터입니다.

## 빠른 실행

필요 환경: Node.js 24 이상.

```bash
npm run dev
```

브라우저에서 <http://127.0.0.1:4173>을 엽니다. 포트나 호스트를 바꾸려면 `PORT=5173 HOST=0.0.0.0 npm run dev`처럼 실행합니다.

## 검증

```bash
npm run check
npm test
```

- `npm run check`: `dist/data.js`, `dist/engine.js`, `dist/buildings.js`, `dist/map.js`, `dist/operations.js`, `dist/app.js`, `server.mjs` 구문 검사.
- `npm test`: 연결 판정, 전체 건물 조회·누락 검증, CSV 내보내기, 지도 실패 대체 화면, 정적 서버와 개발 서버 기동 검증.

## 3분 시연 순서

1. **06:00 상황 확인**: 네 마을에서 개방 시설로 연결되는 경로를 확인합니다.
2. **06:30 교량 통제**: B는 연결 확인 불가, A는 우회 구간 미확인으로 바뀝니다.
3. **변화 메뉴 / 확인 근거**: A·B의 상태 변화와 미확인 우회 구간을 확인합니다.
4. **A 선택 → 관련 도로 → 우회 구간 통행 가능**: A의 결과만 연결 경로 있음으로 바뀝니다.
5. **시설 → 대피시설 C 개방 확인**: B도 대체 시설에 연결됩니다.
6. **현장 신고 기록**: 내용을 정리하고 미확인 상태로 저장합니다. 신고는 도로 상태를 자동 변경하지 않습니다. 지도 배지와 대응 브리핑에서 확인 대기를 볼 수 있습니다.
7. **인계표 내려받기**: CSV 내용을 확인하고 파일로 저장하거나 복사합니다.
8. **시연 초기화**: 현재 브라우저에 저장된 시연 기록과 변경 상태를 초기화합니다.

## 건물 자료

흰 배경 지도에 행정안전부 주소기반산업지원서비스 기반의 Esri Korea Living Atlas `전국 건물 도형 v2 / Korea Building Footprints v2`를 온라인으로 조회해 표시합니다. 브라우저가 운산면 전체 건물 ID를 먼저 가져온 뒤 1,000개씩 도형을 받아 검증하고 지도에 그립니다. 원본 건물 도형 파일을 저장소나 배포 파일에 포함하지 않습니다.

확인된 건수는 운산면 전체 필터 `sig_cd='44210' AND emd_cd='380'` 기준 4,970건, 기존 프로토타입 bbox 기준 872건입니다. 기존 Overture 추출은 같은 bbox에서 4건에 그쳐 더 이상 건물 기준 자료로 쓰지 않습니다. 원천 레이어는 데이터 기준일 2026.07, 서비스 업데이트 2026.08입니다.

건물은 3D 지형 위에 평면 footprint로 표시합니다. 원천에 실제 높이 값이 없으므로 `gro_flo_co` 지상층수는 속성으로만 보여 주고, 층수로 높이를 추정하지 않습니다. 원천 query가 반환한 record를 모두 받을 수는 있어도 현실 세계의 모든 건물이 포함되었다고 보증할 수는 없습니다. [자료 출처와 사용 원칙](docs/building-data.md), [출처·이용조건](dist/data/BUILDINGS-LICENSE.txt)을 확인하세요.

## 구현 범위

- 2D/3D 지도, 고도 타일, 지도 이동·확대, 마을 선택, 레이어 표시.
- 통제 구간을 제외하는 최단 연결 탐색. 미확인 도로·시설을 포함한 후보는 별도 표시.
- 세 가지 가상 시나리오와 도로·시설 상태 변경. 이전 기본 시나리오와 현재 입력 상태 비교.
- 규칙 기반 대응 브리핑, 다음 확인 행동, 도로·시설별 근거·출처·훈련 확인 시각과 재확인.
- 마을별 미확인 신고 배지, 현장 확인·연결 분석·지형 개관 레이어 구성.
- 신고 키워드 추출, 위치 미확정 처리, 확인 기록, 브라우저 저장.
- 연결 상태, 확인 이력, 대응 브리핑, 다음 조치, 판단 근거를 포함한 UTF-8 CSV 및 복사 기능.
- 모바일 목록/지도 전환과 지도 로드 실패 시 연결 도식.
- 지원 브라우저에서 WebMCP `read_demo_access_status`, `set_demo_scenario` 제공.

## 저장소 구조

- `dist/`: 직접 서비스되는 정적 앱입니다. 별도 빌드 산출물이 아니라 현재 작성본입니다.
- `server.mjs`: Node.js 내장 모듈만 쓰는 로컬 개발 서버입니다.
- `tests/`: Node 기본 테스트 러너 기반 회귀 테스트입니다.
- `docs/02_cps.md`: 현안 정의, 페르소나, 제안 구조, 근거와 한계입니다.
- `docs/00_source-log.md`: 공개자료 출처와 미확인 사항 기록입니다.
- `docs/reference-refinement.md`: Bangkok 레퍼런스의 확인 결과, 반영 기능, 데이터 해석 규칙입니다.
- `docs/workspace.md`: GitHub 작업 루트와 향후 공식 데이터 반영 원칙입니다.
- `.github/`: CI, 이슈 템플릿, PR 템플릿입니다.
- `.devcontainer/`: Codespaces/Dev Container용 Node 24 환경입니다.

## GitHub에서 작업하기

- 로컬: 저장소를 clone한 뒤 `npm run dev`로 실행합니다. npm 패키지 설치가 필요하지 않습니다.
- Codespaces: 저장소의 **Code → Codespaces → Create codespace on main**으로 Node 24 환경을 엽니다. 터미널에서 `npm run dev`를 실행하고 전달된 4173 포트를 엽니다.
- 변경 제안: 이슈/PR 템플릿을 사용합니다. main push와 PR에서 구문 검사 및 회귀 테스트가 자동 실행됩니다.
- 개발 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md), 상세 구조는 [작업 공간 안내](docs/workspace.md)를 참고하세요.

## 데이터와 한계

마을 구획·도로 선형·시설 위치·운영 상태·통제·영향 범위는 공식 현황이나 재난 당시 복원 데이터가 아닙니다. 거리는 가상 선형의 계산값이며 실제 이동 거리·시간이 아닙니다.

신고 정리는 규칙 기반 키워드 추출입니다. 외부 AI, 실시간 센서, 재난문자, 기관 시스템은 연결하지 않았습니다. 홍수 예측, 수심 추정, 경로 안전 판정, 자동 대피명령은 구현 범위에 없습니다. 기록은 해당 브라우저에만 저장됩니다.

배경지도·지형·건물·폰트 자료는 인터넷 연결이 필요합니다. 지도 모듈 또는 배경 연결이 실패하면 가상 연결 도식으로 전환됩니다. 파일 다운로드 지원은 브라우저마다 달라 인계표 복사를 함께 제공합니다.

## 출처

- MapLibre GL JS **5.24.0**은 `dist/vendor/`에 라이선스와 함께 포함했습니다.
- [OpenFreeMap](https://openfreemap.org/) / [OpenStreetMap](https://www.openstreetmap.org/copyright): 배경지도.
- [Mapterhorn](https://mapterhorn.com/attribution): 고도 자료.
- [MapLibre 공식 문서](https://maplibre.org/maplibre-gl-js/docs/): 지도 API.
- [Bangkok 참고 사이트](https://situational-bangkok-flood.web.app/3d/): 지도 중심 구성과 레이어·상세 정보 표현 참고.

검증 기록은 `QA.md`에 남겨 두었습니다. 실제 운영 단계에서는 공식 도로·시설 자료, 현장 검증, 접근 권한, 기록 감사, 기관 연계를 별도로 구현해야 합니다.

## 공모전 근거·업무 검증 · 2026-10-03

- 상황판 **확인** 메뉴: 미확인·오래된 도로/시설 하나를 두 상태로 가정해 연결 판정이 달라지는 마을 수를 비교합니다. 실제 상태를 변경하지 않으며, 구조·대피 순위를 뜻하지 않습니다. 인계 CSV에 같은 조건 비교를 포함합니다.
- [`regional.html`](dist/regional.html): 공개 도로 객체 313개, 교량 태그 도로 객체 33개, 공식 주소 기반 시설 6곳의 출처·좌표 검토 화면입니다. 시설 5곳은 건물 도형과 주소를 대조했고, 풍수해 지정·개방 상태는 모두 미확인입니다. 실제 지역 자료는 운영용 가상 도로망과 분리합니다.
- [`evaluation.html`](dist/evaluation.html): 가상 사례 6개를 자료표 방식과 연결 분석 보조로 비교합니다. 시간·마을 판정 오류·미확인 누락/과잉 선택을 기록하며, 같은 평가코드·사례의 두 방식이 있어야 짝지어 계산합니다. 실제 현행업무와 현장 효과를 검증한 결과는 아직 없습니다.
- [평가 기준별 제안](docs/competition-positioning.md), [인터뷰 키트](docs/field-interview-kit.md), [지역 자료 검토](docs/regional-validation.md), [효과 평가 계획](docs/10_eval-plan.md).
- `npm run build`는 위 문서 4개를 사이트 다운로드용으로 복사합니다. `npm run check`와 `npm test`로 코드·자료·계산을 검증합니다.
- `node scripts/fetch-regional-data.mjs`는 공개 원자료를 재조회합니다. 도로 수·좌표·출처 변경 내용을 검토한 뒤 사이트를 갱신해야 합니다.
