# 운산면 건물 데이터 출처와 사용 원칙

이 문서는 프로토타입의 건물 footprint 레이어에 쓰는 원천, 조회 범위, 이용조건, 한계를 기록한다. 건물 도형은 배경 시각화와 현장 설명을 돕기 위한 자료이며, 대피명령·피해 산정·건축물 공식 판정 자료를 대체하지 않는다.

## 원천 데이터

- 서비스명: Esri Korea Living Atlas `전국 건물 도형 v2 / Korea Building Footprints v2`
- ArcGIS item: https://www.arcgis.com/home/item.html?id=b2c7a37bac8d4e40a85435b3f3d96d05
- Feature layer: https://portal.esrikr.com/arcgis/rest/services/MOIS_KR_Buildings_v2/FeatureServer/0
- 원본 데이터 출처: 행정안전부 주소기반산업지원서비스
- 원본 출처 링크: https://business.juso.go.kr/jst/jstAddressCuration
- Release Version: `2026.1`
- 데이터 기준일: `2026.07`
- 서비스 업데이트: `2026.08`
- 다음 업데이트 예정: `2027.02`
- 원본 좌표계: KGD2002 Unified Coordinate System, EPSG:5179
- 레이어 geometry: polygon, `hasZ=false`

[항목 메타데이터](https://www.arcgis.com/sharing/rest/content/items/b2c7a37bac8d4e40a85435b3f3d96d05?f=pjson)와 [레이어 메타데이터](https://portal.esrikr.com/arcgis/rest/services/MOIS_KR_Buildings_v2/FeatureServer/0?f=pjson)를 2026-10-01에 확인했다. 레이어 필드에는 `objectid`, `building_id`, `building_name`, `gro_flo_co`, `und_flo_co`, `sig_cd`, `emd_cd`, `street_name`, `house_number` 등이 있다.

## 조회 범위와 확인된 건수

프로토타입은 브라우저에서 운산면 전체 건물 도형을 온라인으로 조회한다. 조회 결과를 오프라인 파일로 배포하지 않는다.

확인된 기준 건수:

| 범위 | 필터 / 기준 | 건수 | 해석 |
| --- | --- | ---: | --- |
| 서산시 운산면 전체 | `sig_cd='44210' AND emd_cd='380'` | 4,970 | 원천 레이어가 반환한 운산면 전체 건물 record 수 |
| 기존 프로토타입 bbox | `126.599,36.744,126.640,36.795` | 872 | 같은 범위에서 Esri Korea 레이어가 반환한 건물 수 |
| 기존 Overture 추출 | 같은 bbox의 Overture Buildings 추출 | 4 | 국내 농촌 건물 누락이 커서 더 이상 기준으로 쓰지 않음 |

이 숫자는 “원천 레이어가 해당 조건에서 반환한 record 수”이다. 실제 현장의 모든 건물이 빠짐없이 포함되었다는 보증은 아니다. 신축·철거 반영 지연, 주소 기반 자료의 갱신 시차, 원천 등록 누락이 있을 수 있다.

## 앱에서의 취득 방식

현재 구현 원칙은 오프라인 번들 export가 아니라 온라인 조회다.

1. 브라우저가 FeatureServer query로 대상 범위의 `objectid` 목록을 먼저 조회한다.
2. 반환된 ID를 chunk로 나누어 필요한 속성과 polygon geometry를 가져온다.
3. 응답마다 `objectid`와 geometry 존재 여부를 확인한다.
4. 받은 geometry는 메모리에서만 지도 렌더링에 사용한다.
5. `dist/data/`에 전국·운산면 건물 export 파일을 저장하지 않는다.

이 방식은 레이어의 이용조건인 온라인 시각화와 분석 범위에 맞춘 것이다. 대량 다운로드, 재배포용 오프라인 패키지, 국외 오프라인 반출용 export로 사용하지 않는다.

## 표시 방식

- 건물은 3D 지형 위에 footprint polygon으로 표시한다.
- 원천 레이어에는 실제 높이 값이 없다.
- `gro_flo_co`는 “지상층수” 원천 속성으로만 표시한다.
- 층수로 실제 건물 높이를 추정해 extrusion하지 않는다.
- `hasZ=false`이므로 geometry 자체에 고도나 높이 좌표가 없다.
- 이름·도로명주소·지상/지하 층수를 건물 클릭 팝업에서 확인할 수 있다.

## 이용조건 해석

ArcGIS item의 licenseInfo에는 다음 취지의 조건이 적혀 있다.

- 권리: Korean Ministry of Interior and Safety에 권리 보유 표시.
- 용도: 온라인 시각화와 분석 지원.
- 제한: 한국 밖에서 오프라인 사용을 위해 데이터를 export하는 행위는 허용되지 않음.

이 조건을 앱 문서에서는 좁고 정확하게 해석한다. 즉 “국외 오프라인 사용을 위한 export 금지”를 의미하며, 한국 내 온라인 시각화·분석 자체를 금지한다거나 모든 API 조회를 금지한다는 식으로 넓혀 쓰지 않는다. 반대로 이 문구가 오프라인 재배포나 국외 반출을 허용한다는 뜻도 아니다.

## 검증 항목

구현 검증은 다음 항목을 기준으로 한다.

- 운산면 전체 count query가 `sig_cd='44210' AND emd_cd='380'`에서 4,970을 반환하는지 확인한다.
- 기존 bbox count query가 872를 반환하는지 확인한다.
- ID 목록 조회와 chunk별 feature 조회 뒤 반환된 `objectid` 수가 요청 ID 수와 맞는지 확인한다.
- 각 feature에 polygon geometry가 있는지 확인한다.
- 좌표 변환 후 지도 위 건물 위치가 원평리·고풍리 마을권과 맞는지 육안 검토한다.
- 브라우저 저장소나 `dist/data/`에 오프라인 건물 export가 남지 않는지 확인한다.

## 한계

- 원천 레이어가 반환한 모든 record를 표시할 수는 있지만, 현실 세계의 건물 100% 포함을 보증할 수는 없다.
- 실제 높이 값이 없으므로 건물은 평면 footprint로 표시한다.
- `gro_flo_co`는 층수 속성이지 높이(m)가 아니다.
- 도로 통제, 대피 가능성, 침수 깊이, 피해 규모는 이 건물 레이어에서 자동 산출하지 않는다.
- 원천 서비스가 일시적으로 느리거나 차단되면 건물 레이어는 표시되지 않을 수 있다.
- 원천 서비스의 이용조건이 바뀌면 앱의 조회·표시 방식도 다시 검토해야 한다.

## 문서 교체 이력

이전 문서는 Overture Maps Buildings 추출을 기준으로 작성되어 있었다. 같은 bbox에서 Overture 추출이 4건에 그쳐 국내 농촌 주거지 표현에 맞지 않았고, 현재 기준 문서는 Esri Korea Living Atlas의 행정안전부 주소기반산업지원서비스 기반 건물 도형으로 교체했다.
