import { writeFile, mkdir } from 'node:fs/promises';

const BUILDING_LAYER =
  'https://portal.esrikr.com/arcgis/rest/services/MOIS_KR_Buildings_v2/FeatureServer/0/query';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OUT_DIR = new URL('../dist/data/', import.meta.url);

const targetBbox = [126.595, 36.745, 126.645, 36.795];

const officialPlaces = [
  {
    id: 'wonpyeong-village-hall',
    name: '원평리 마을회관·경로당',
    category: 'village_hall_senior_center',
    officialAddress: '충청남도 서산시 운산면 원평1로 3',
    streetName: '원평1로',
    houseNumber: '3',
    officialSourceId: 'seosan-unsan-welfare',
    floodUseStatus: 'not_verified_as_flood_shelter',
  },
  {
    id: 'wonpyeong-women-hall',
    name: '원평부녀 마을회관·경로당',
    category: 'village_hall_senior_center',
    officialAddress: '충청남도 서산시 운산면 원평2길 242',
    streetName: '원평2길',
    houseNumber: '242',
    officialSourceId: 'seosan-unsan-welfare',
    floodUseStatus: 'not_verified_as_flood_shelter',
  },
  {
    id: 'gopung-village-hall',
    name: '고풍리 마을회관·경로당',
    category: 'village_hall_senior_center',
    officialAddress: '충청남도 서산시 운산면 고풍1길 6',
    streetName: '고풍1길',
    houseNumber: '6',
    officialSourceId: 'seosan-unsan-welfare',
    floodUseStatus: 'not_verified_as_flood_shelter',
  },
  {
    id: 'gopung-gosaek-hall',
    name: '고풍리 고색동 마을회관·경로당',
    category: 'village_hall_senior_center',
    officialAddress: '충청남도 서산시 운산면 고풍2길 2',
    streetName: '고풍2길',
    houseNumber: '2',
    officialSourceId: 'seosan-unsan-welfare',
    floodUseStatus: 'not_verified_as_flood_shelter',
  },
  {
    id: 'gopung-yeongrakwon-hall',
    name: '고풍리 영락원 마을회관·경로당',
    category: 'village_hall_senior_center',
    officialAddress: '충청남도 서산시 운산면 군장동대길 115',
    streetName: '군장동대길',
    houseNumber: '115',
    officialSourceId: 'seosan-unsan-welfare',
    floodUseStatus: 'not_verified_as_flood_shelter',
  },
  {
    id: 'wonpyeong-health-post',
    name: '원평보건진료소',
    category: 'public_health_facility',
    officialAddress: '충청남도 서산시 운산면 봉운로 889',
    streetName: '봉운로',
    houseNumber: '889',
    officialSourceId: 'seosan-health-office',
    floodUseStatus: 'not_verified_as_flood_shelter',
  },
];

const sources = [
  {
    id: 'seosan-unsan-welfare',
    title: '서산시 복지넷 운산면 마을회관 및 경로당 현황',
    publisher: '서산시',
    url: 'https://www.seosan.go.kr/welfare/contents.do?key=2436',
    checkedAt: '2026-10-03',
    use: '원평리·고풍리 마을회관/경로당 명칭과 도로명주소 확인',
  },
  {
    id: 'seosan-health-office',
    title: '서산시 보건소 조직도 및 직원안내',
    publisher: '서산시 보건소',
    url: 'https://www.seosan.go.kr/health/contents.do?key=271',
    checkedAt: '2026-10-03',
    use: '원평보건진료소 명칭과 도로명주소 확인',
  },
  {
    id: 'mois-building-footprints',
    title: '전국 건물 도형 v2 / Korea Building Footprints v2',
    publisher: 'Esri Korea Living Atlas, 원자료: 행정안전부 주소기반산업지원서비스',
    url: 'https://www.arcgis.com/home/item.html?id=b2c7a37bac8d4e40a85435b3f3d96d05',
    checkedAt: '2026-10-03',
    use: '도로명주소에 대응되는 운산면 건물 객체와 좌표 확인',
  },
  {
    id: 'osm-overpass',
    title: 'OpenStreetMap road ways via Overpass API',
    publisher: 'OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
    checkedAt: '2026-10-03',
    use: '원평리·고풍리 권역 도로 형상 부분 추출. 통행 가능 여부 자료가 아님.',
  },
  {
    id: 'presidential-disaster-area-2025-07-22',
    title: '집중호우 특별재난지역 6개 시군 우선 선포',
    publisher: '대통령실 / 대한민국 정책브리핑',
    url: 'https://www.korea.kr/briefing/presidentView.do?newsId=148950860',
    checkedAt: '2026-10-03',
    use: '서산시가 2025년 7월 호우 특별재난지역 우선 선포 대상에 포함된 사실 확인',
  },
  {
    id: 'seosan-small-stream-recovery-2026-09-22',
    title: '서산시, 원평 소하천 개선 복구 절차 본격 착수',
    publisher: '서산시',
    url: 'https://seosan-city.tistory.com/15893',
    checkedAt: '2026-10-03',
    use: '원평리·고풍리 주민대표 참여, 원평 소하천 복구계획 규모와 교량 신설 계획 확인',
  },
];

function centroidOfRing(ring) {
  const sum = ring.reduce(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
    [0, 0],
  );
  return [sum[0] / ring.length, sum[1] / ring.length];
}

async function queryBuilding(place) {
  const where = [
    "sig_cd='44210'",
    "emd_cd='380'",
    `street_name='${place.streetName}'`,
    `house_number='${place.houseNumber}'`,
  ].join(' AND ');
  const params = new URLSearchParams({
    f: 'json',
    where,
    outFields:
      'objectid,building_id,building_name,street_name,house_number,sig_cd,emd_cd,gro_flo_co',
    returnGeometry: 'true',
    outSR: '4326',
  });
  const response = await fetch(`${BUILDING_LAYER}?${params}`);
  if (!response.ok) throw new Error(`Building query failed: ${response.status}`);
  const data = await response.json();
  const feature = data.features?.[0];
  if (!feature?.geometry?.rings?.[0]) {
    return {
      ...place,
      coordinate: null,
      verificationLevel: 'official-address-only',
      coordinateSource: null,
      notes: ['공식 주소는 확인했으나 행안부 주소기반 건물 레이어에서 일치 건물을 찾지 못했다.'],
    };
  }
  const coordinate = centroidOfRing(feature.geometry.rings[0]);
  return {
    ...place,
    coordinate: {
      lon: Number(coordinate[0].toFixed(8)),
      lat: Number(coordinate[1].toFixed(8)),
    },
    verificationLevel: 'official-address-and-building-object',
    coordinateSource: {
      sourceId: 'mois-building-footprints',
      objectid: feature.attributes.objectid,
      buildingId: feature.attributes.building_id,
      buildingName: feature.attributes.building_name || null,
      groundFloors: feature.attributes.gro_flo_co,
      method: 'polygon-centroid',
    },
    notes: ['좌표는 건물 도형 중심점이며 풍수해 대피시설 지정 또는 개방 상태를 뜻하지 않는다.'],
  };
}

async function fetchRoads() {
  const [minLon, minLat, maxLon, maxLat] = targetBbox;
  const geometryQuery = `[out:json][timeout:30];(
  way["highway"](${minLat},${minLon},${maxLat},${maxLon});
);out geom tags;`;
  const topologyQuery = `[out:json][timeout:30];
way["highway"](${minLat},${minLon},${maxLat},${maxLon});
out body;
>;
out skel qt;`;
  const [geometryResponse, topologyResponse] = await Promise.all([
    fetch(OVERPASS, {
      method: 'POST',
      body: new URLSearchParams({ data: geometryQuery }),
      headers: { 'User-Agent': 'unsan-flood-access-prototype/0.1' },
    }),
    fetch(OVERPASS, {
      method: 'POST',
      body: new URLSearchParams({ data: topologyQuery }),
      headers: { 'User-Agent': 'unsan-flood-access-prototype/0.1' },
    }),
  ]);
  if (!geometryResponse.ok) throw new Error(`Overpass geometry query failed: ${geometryResponse.status}`);
  if (!topologyResponse.ok) throw new Error(`Overpass topology query failed: ${topologyResponse.status}`);
  const data = await geometryResponse.json();
  const topologyData = await topologyResponse.json();
  const timestamp = data.osm3s?.timestamp_osm_base || null;
  const topologyTimestamp = topologyData.osm3s?.timestamp_osm_base || null;
  const features = (data.elements || [])
    .filter((element) => element.type === 'way' && element.geometry?.length)
    .map((way) => ({
      type: 'Feature',
      properties: {
        osmType: 'way',
        osmId: way.id,
        name: way.tags?.name || null,
        highway: way.tags?.highway || null,
        bridge: way.tags?.bridge || null,
        layer: way.tags?.layer || null,
        surface: way.tags?.surface || null,
        source: 'OpenStreetMap contributors via Overpass API',
        verificationLevel: 'public-map-geometry-only',
        trafficStatus: 'unknown',
      },
      geometry: {
        type: 'LineString',
        coordinates: way.geometry.map((point) => [point.lon, point.lat]),
      },
    }));
  return {
    timestamp,
    topologyTimestamp,
    topologyData,
    topologyQuery,
    geojson: {
      type: 'FeatureCollection',
      name: 'unsan-wonpyeong-gopung-osm-roads',
      bbox: targetBbox,
      properties: {
        generatedAt: new Date().toISOString(),
        source: 'OpenStreetMap contributors via Overpass API',
        license: 'ODbL',
        query: geometryQuery,
        osmBaseTimestamp: timestamp,
        warning:
          'This file contains public road geometry only. It does not verify flood closure, passability, bridge safety, or official emergency routes.',
      },
      features,
    },
  };
}

function summarizeTopology(topologyData, timestamp, query) {
  const vehicleLikeHighways = new Set([
    'living_street',
    'motorway',
    'primary',
    'residential',
    'secondary',
    'secondary_link',
    'service',
    'tertiary',
    'tertiary_link',
    'trunk',
    'unclassified',
  ]);
  const ways = (topologyData.elements || []).filter((element) => element.type === 'way');
  const nodes = (topologyData.elements || []).filter((element) => element.type === 'node');
  const includedWays = ways.filter((way) => vehicleLikeHighways.has(way.tags?.highway));
  const nodeToWays = new Map();
  for (const way of includedWays) {
    for (const nodeId of way.nodes || []) {
      if (!nodeToWays.has(nodeId)) nodeToWays.set(nodeId, []);
      nodeToWays.get(nodeId).push(way.id);
    }
  }
  const graph = new Map(includedWays.map((way) => [way.id, new Set()]));
  for (const connectedWays of nodeToWays.values()) {
    if (connectedWays.length < 2) continue;
    for (const wayId of connectedWays) {
      for (const otherWayId of connectedWays) {
        if (otherWayId !== wayId) graph.get(wayId)?.add(otherWayId);
      }
    }
  }
  const visited = new Set();
  const componentSizes = [];
  for (const wayId of graph.keys()) {
    if (visited.has(wayId)) continue;
    const stack = [wayId];
    visited.add(wayId);
    let size = 0;
    while (stack.length) {
      const current = stack.pop();
      size += 1;
      for (const next of graph.get(current) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    componentSizes.push(size);
  }
  componentSizes.sort((a, b) => b - a);
  return {
    osmBaseTimestamp: timestamp,
    query,
    verificationLevel: 'public-map-topology-only',
    scope:
      'OSM highway ways in the target bbox, filtered to vehicle-like highway classes for a rough shared-node graph.',
    rawWayCount: ways.length,
    rawNodeCount: nodes.length,
    includedWayCount: includedWays.length,
    includedHighwayClasses: [...vehicleLikeHighways].sort(),
    sharedNodeCount: [...nodeToWays.values()].filter((wayIds) => wayIds.length > 1).length,
    unsharedNodeCount: [...nodeToWays.values()].filter((wayIds) => wayIds.length === 1).length,
    componentCount: componentSizes.length,
    largestComponentWayCount: componentSizes[0] || 0,
    componentSizesTop10: componentSizes.slice(0, 10),
    limitation:
      'OSM node connectivity does not prove legal access, flood passability, road width, bridge safety, or emergency route suitability.',
  };
}

function summarizeRoads(geojson, timestamp, topology) {
  const byHighway = {};
  let bridgeTaggedWays = 0;
  const namedRoads = new Set();
  for (const feature of geojson.features) {
    const { highway, bridge, name } = feature.properties;
    byHighway[highway] = (byHighway[highway] || 0) + 1;
    if (bridge) bridgeTaggedWays += 1;
    if (name) namedRoads.add(name);
  }
  return {
    file: 'unsan-osm-roads.geojson',
    extractionBbox: targetBbox,
    osmBaseTimestamp: timestamp,
    featureCount: geojson.features.length,
    highwayTypeCounts: byHighway,
    bridgeTaggedWayCount: bridgeTaggedWays,
    namedRoads: [...namedRoads].sort(),
    trafficStatus: 'unknown',
    verificationLevel: 'public-map-geometry-only',
    license: 'ODbL',
    topology,
  };
}

await mkdir(OUT_DIR, { recursive: true });

const [places, roads] = await Promise.all([
  Promise.all(officialPlaces.map(queryBuilding)),
  fetchRoads(),
]);

const regionalEvidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  targetArea: {
    name: '충청남도 서산시 운산면 원평리·고풍리 원평소하천 주변',
    center: { lon: 126.6203, lat: 36.7691 },
    bbox: targetBbox,
    reason:
      '2025년 7월 호우 특별재난지역에 서산시가 포함됐고, 원평 소하천 개선복구 계획에 원평리·고풍리 주민대표가 참여한 공개자료가 있다.',
  },
  sources,
  places,
  roads: summarizeRoads(
    roads.geojson,
    roads.timestamp,
    summarizeTopology(roads.topologyData, roads.topologyTimestamp, roads.topologyQuery),
  ),
  eventEvidence: [
    {
      id: 'seosan-special-disaster-2025-07',
      sourceId: 'presidential-disaster-area-2025-07-22',
      claim:
        '서산시는 2025년 7월 집중호우 특별재난지역 6개 시군 우선 선포 대상에 포함됐다.',
      verificationLevel: 'city-level-official',
      limitation: '원평리·고풍리의 개별 침수·통제 지점이나 피해액을 확정하지 않는다.',
    },
    {
      id: 'wonpyeong-stream-recovery-plan',
      sourceId: 'seosan-small-stream-recovery-2026-09-22',
      claim:
        '원평 소하천 복구계획은 원평리·고풍리 주민대표가 참여한 보상협의회와 약 6.88km 정비, 교량 6개 신설 계획을 포함한다.',
      verificationLevel: 'local-government-announcement',
      limitation: '계획 자료이며 현재 통행상태, 침수경계, 공정률을 증명하지 않는다.',
    },
  ],
  unresolved: [
    '풍수해 대피시설 지정 목록에서 원평리·고풍리 시설의 공식 지정 여부를 공개자료만으로 확정하지 못했다.',
    '고풍리 마을회관·경로당 주소 고풍1길 6은 서산시 목록에서 확인됐지만 건물 레이어의 동일 주소 객체는 확인하지 못했다.',
    'OSM 도로·교량 태그는 지도 형상 자료이며 실제 호우 당시 통제, 침수, 유실, 복구완료 상태가 아니다.',
    '원평소하천의 정확한 선형, 호안·교량별 공사 위치, 과거 침수흔적도는 공개자료에서 좌표형 원자료를 확보하지 못했다.',
  ],
};

await writeFile(new URL('unsan-osm-roads.geojson', OUT_DIR), `${JSON.stringify(roads.geojson, null, 2)}\n`);
await writeFile(
  new URL('regional-evidence.json', OUT_DIR),
  `${JSON.stringify(regionalEvidence, null, 2)}\n`,
);

console.log(
  JSON.stringify(
    {
      places: places.length,
      coordinateVerified: places.filter((place) => place.coordinate).length,
      roadFeatures: roads.geojson.features.length,
      bridgeTaggedWays: regionalEvidence.roads.bridgeTaggedWayCount,
      topologyComponents: regionalEvidence.roads.topology.componentCount,
      roadFile: 'prototype/dist/data/unsan-osm-roads.geojson',
      evidenceFile: 'prototype/dist/data/regional-evidence.json',
    },
    null,
    2,
  ),
);
