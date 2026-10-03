import {DEPTH_BANDS} from './flood-analysis.js';

export const OFFICIAL_FLOOD_BBOX = [126.595, 36.745, 126.645, 36.795];
export const OFFICIAL_FLOOD_DOWNLOAD = {
  url: 'https://data.floodmap.go.kr/api/shp/download',
  list_url: 'https://data.floodmap.go.kr/api/shp-file-list/adm-rgn',
  fileEngNm: 'RFM_SGG_RGN_44210_100.zip',
  fileKorNm: '행정구역 충청남도 서산시 100년 빈도 지방하천 하천범람지도.zip',
  dataNm: '행정구역별 100년 빈도 지방하천 하천범람지도',
  infoUpdtYm: '202512',
  compressedBytes: 45283890
};

export const OFFICIAL_FLOOD_METADATA = {
  title: '서산시 100년 빈도 지방하천 하천범람지도',
  source: '환경부 한강홍수통제소 홍수위험지도 정보제공포털',
  source_url: 'https://data.floodmap.go.kr/main/board/map_data_download',
  scenario: '행정구역별 100년 빈도 지방하천 하천범람지도',
  kind: 'official',
  official: true,
  frequencyYears: 100,
  updated: '2025-12',
  license: '공공누리 제4유형',
  license_url: 'https://www.kogl.or.kr/info/licenseType4.do',
  attribution: '환경부 한강홍수통제소 홍수위험지도 정보제공포털',
  note: '원본 SHP를 사용자 요청 시 내려받아 브라우저 메모리에서만 해석합니다. 3D 높이는 수심 구간의 표시용 상한값입니다.'
};

const MAX_COMPRESSED_BYTES = 60 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_LOCAL_FILE = 0x04034b50;
const REQUIRED_EXTENSIONS = new Set(['.shp', '.dbf', '.prj']);
const TEXT_DECODER = new TextDecoder();
const DBF_DECODER = new TextDecoder('euc-kr', {fatal: false});
const GRS80_A = 6378137;
const GRS80_INV_F = 298.257222101;
const TM_LAT0 = 38 * Math.PI / 180;
const TM_LON0 = 127 * Math.PI / 180;
const TM_K0 = 1;
const TM_FALSE_EASTING = 200000;
const TM_FALSE_NORTHING = 600000;
const TM_E2 = 2 / GRS80_INV_F - 1 / (GRS80_INV_F * GRS80_INV_F);
const TM_EP2 = TM_E2 / (1 - TM_E2);
const TM_M0 = meridionalArc(TM_LAT0);

const DEPTH_CLASSES = new Map([
  ['N330', {min: 0, max: 0.5, label: '0.5 m 미만', height: 0.5, color: DEPTH_BANDS[0].color}],
  ['N331', {min: 0.5, max: 1, label: '0.5-1 m', height: 1, color: DEPTH_BANDS[1].color}],
  ['N332', {min: 1, max: 2, label: '1-2 m', height: 2, color: DEPTH_BANDS[2].color}],
  ['N333', {min: 2, max: 5, label: '2-5 m', height: 5, color: DEPTH_BANDS[3].color}],
  ['N334', {min: 5, max: null, label: '5 m 이상', height: 5, color: DEPTH_BANDS[4].color}]
]);

export async function loadOfficialFlood({fetcher = globalThis.fetch, onProgress = () => {}, signal} = {}) {
  if (typeof fetcher !== 'function') throw Error('fetcher가 필요합니다');
  if (shouldUseOfficialFloodWorker(fetcher)) {
    return loadOfficialFloodInWorker({onProgress, signal});
  }
  return loadOfficialFloodCore({fetcher, onProgress, signal});
}

export async function loadOfficialFloodCore({fetcher = globalThis.fetch, onProgress = () => {}, signal} = {}) {
  if (typeof fetcher !== 'function') throw Error('fetcher가 필요합니다');
  throwIfAborted(signal);
  onProgress({stage: 'request', message: '공식 침수 ZIP 요청 중', source: OFFICIAL_FLOOD_DOWNLOAD.url});
  const zipBuffer = await fetchOfficialZip({fetcher, signal});
  await yieldIfAborted(signal);
  onProgress({stage: 'downloaded', message: '공식 침수 ZIP 다운로드 완료', bytes: zipBuffer.byteLength});
  const entries = await parseZipEntries(zipBuffer);
  await yieldIfAborted(signal);
  onProgress({stage: 'unzipped', message: 'SHP/DBF/PRJ 압축 해제 완료', entries: entries.map(entry => entry.name)});
  const bundle = officialBundle(entries);
  validateOfficialProjection(bundle.prj);
  await yieldIfAborted(signal);
  const rows = parseDbf(bundle.dbf);
  await yieldIfAborted(signal);
  const shapes = parseShp(bundle.shp);
  await yieldIfAborted(signal);
  onProgress({stage: 'parsed', message: '공식 도형과 수심 구간 해석 완료', rows: rows.length, shapes: shapes.length});
  return buildOfficialFeatureCollection({rows, shapes, bbox: OFFICIAL_FLOOD_BBOX});
}

export function loadOfficialFloodInWorker({onProgress = () => {}, signal, WorkerCtor = globalThis.Worker} = {}) {
  if (typeof WorkerCtor !== 'function') throw Error('이 브라우저는 공식 침수 Worker를 지원하지 않습니다');
  throwIfAborted(signal);
  let worker;
  let settled = false;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', abort);
      worker?.terminate?.();
    };
    const fail = error => {
      cleanup();
      reject(error instanceof Error ? error : Error(String(error?.message ?? error ?? '공식 침수 Worker 오류')));
    };
    const abort = () => fail(signal?.reason ?? Error('공식 침수 자료 처리가 취소되었습니다'));
    try {
      worker = new WorkerCtor(new URL('./flood-official-worker.js', import.meta.url), {type: 'module'});
    } catch (error) {
      fail(error);
      return;
    }
    signal?.addEventListener?.('abort', abort, {once: true});
    worker.onmessage = event => {
      const message = event.data ?? {};
      if (message.type === 'progress') {
        onProgress(message.progress ?? {});
        return;
      }
      if (message.type === 'result') {
        cleanup();
        resolve(message.collection);
        return;
      }
      if (message.type === 'error') {
        fail(Error(message.message || '공식 침수 Worker 오류'));
      }
    };
    worker.onerror = event => fail(Error(event.message || '공식 침수 Worker 실행 오류'));
    worker.onmessageerror = () => fail(Error('공식 침수 Worker 메시지를 해석하지 못했습니다'));
    worker.postMessage({type: 'load'});
  });
}

export async function fetchOfficialZip({fetcher = globalThis.fetch, signal} = {}) {
  const body = new URLSearchParams({
    fileEngNm: OFFICIAL_FLOOD_DOWNLOAD.fileEngNm,
    fileKorNm: OFFICIAL_FLOOD_DOWNLOAD.fileKorNm,
    dataNm: OFFICIAL_FLOOD_DOWNLOAD.dataNm
  });
  const response = await fetcher(OFFICIAL_FLOOD_DOWNLOAD.url, {
    method: 'POST',
    body,
    signal,
    credentials: 'omit',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'}
  });
  if (!response?.ok) throw Error(`공식 침수 ZIP 다운로드 실패: ${response?.status ?? 'unknown'}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_COMPRESSED_BYTES) throw Error('공식 침수 ZIP이 허용 크기를 초과했습니다');
  return buffer;
}

export function officialDownloadRequest() {
  return {
    url: OFFICIAL_FLOOD_DOWNLOAD.url,
    method: 'POST',
    body: new URLSearchParams({
      fileEngNm: OFFICIAL_FLOOD_DOWNLOAD.fileEngNm,
      fileKorNm: OFFICIAL_FLOOD_DOWNLOAD.fileKorNm,
      dataNm: OFFICIAL_FLOOD_DOWNLOAD.dataNm
    })
  };
}

export async function parseZipEntries(buffer) {
  const bytes = toUint8(buffer);
  if (bytes.byteLength > MAX_COMPRESSED_BYTES) throw Error('ZIP 압축 파일이 허용 크기를 초과했습니다');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (centralOffset + centralSize > view.byteLength) throw Error('ZIP 중앙 디렉터리 범위가 잘못되었습니다');

  let offset = centralOffset;
  let totalUncompressed = 0;
  const entries = [];
  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_FILE) throw Error('ZIP 중앙 디렉터리 항목이 손상되었습니다');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = TEXT_DECODER.decode(slice(bytes, offset + 46, fileNameLength));
    offset += 46 + fileNameLength + extraLength + commentLength;

    const extension = extensionOf(name);
    if (!REQUIRED_EXTENSIONS.has(extension)) continue;
    if (localOffset + 30 > view.byteLength) throw Error('ZIP 로컬 항목 범위가 잘못되었습니다');
    if (view.getUint32(localOffset, true) !== ZIP_LOCAL_FILE) throw Error('ZIP 로컬 항목이 손상되었습니다');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > view.byteLength) throw Error('ZIP 압축 데이터 범위가 잘못되었습니다');
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw Error('ZIP 압축 해제 크기가 허용 범위를 초과했습니다');
    const compressed = slice(bytes, dataOffset, compressedSize);
    const data = method === 0 ? compressed : await inflateZipEntry(compressed, method);
    if (data.byteLength !== uncompressedSize) throw Error('ZIP 압축 해제 크기가 중앙 디렉터리와 다릅니다');
    entries.push({name, extension, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)});
  }
  return entries;
}

export function parseDbf(buffer) {
  const bytes = toUint8(buffer);
  if (bytes.byteLength < 65) throw Error('DBF 파일이 너무 작습니다');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  if (headerLength > bytes.byteLength || recordLength < 1) throw Error('DBF 헤더 범위가 잘못되었습니다');

  const fields = [];
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    if (bytes[offset] === 0x0d) break;
    const nameBytes = [];
    for (let i = 0; i < 11 && bytes[offset + i] !== 0; i++) nameBytes.push(bytes[offset + i]);
    const name = TEXT_DECODER.decode(new Uint8Array(nameBytes)).trim();
    const type = String.fromCharCode(bytes[offset + 11]);
    const length = bytes[offset + 16];
    fields.push({name, type, length});
  }

  const rows = [];
  for (let rowIndex = 0; rowIndex < recordCount; rowIndex++) {
    const offset = headerLength + rowIndex * recordLength;
    if (offset + recordLength > bytes.byteLength) throw Error('DBF 레코드 범위가 잘못되었습니다');
    if (bytes[offset] === 0x2a) {
      rows.push(null);
      continue;
    }
    let cursor = offset + 1;
    const row = {};
    for (const field of fields) {
      const raw = slice(bytes, cursor, field.length);
      const text = DBF_DECODER.decode(raw).replace(/\0/g, '').trim();
      row[field.name] = field.type === 'N' || field.type === 'F' ? numberOrText(text) : text;
      cursor += field.length;
    }
    rows.push(row);
  }
  return rows;
}

export function parseShp(buffer) {
  const bytes = toUint8(buffer);
  if (bytes.byteLength < 100) throw Error('SHP 파일이 너무 작습니다');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getInt32(0, false) !== 9994) throw Error('SHP 파일 코드가 아닙니다');
  const shapes = [];
  let offset = 100;
  while (offset + 8 <= view.byteLength) {
    const recordNumber = view.getInt32(offset, false);
    const contentBytes = view.getInt32(offset + 4, false) * 2;
    const contentOffset = offset + 8;
    if (contentBytes < 4 || contentOffset + contentBytes > view.byteLength) throw Error('SHP 레코드 범위가 잘못되었습니다');
    const shapeType = view.getInt32(contentOffset, true);
    if (shapeType !== 0) {
      if (![5, 15, 25].includes(shapeType)) throw Error(`지원하지 않는 SHP 도형 타입입니다: ${shapeType}`);
      const numParts = view.getInt32(contentOffset + 36, true);
      const numPoints = view.getInt32(contentOffset + 40, true);
      const partsOffset = contentOffset + 44;
      const pointsOffset = partsOffset + numParts * 4;
      if (numParts < 1 || numPoints < 4 || pointsOffset + numPoints * 16 > contentOffset + contentBytes) {
        throw Error('SHP 폴리곤 레코드 범위가 잘못되었습니다');
      }
      const parts = Array.from({length: numParts}, (_, index) => view.getInt32(partsOffset + index * 4, true));
      const points = Array.from({length: numPoints}, (_, index) => {
        const cursor = pointsOffset + index * 16;
        const projected = [view.getFloat64(cursor, true), view.getFloat64(cursor + 8, true)];
        return epsg5186ToLonLat(projected[0], projected[1]);
      });
      const rings = parts.map((start, index) => {
        const end = parts[index + 1] ?? points.length;
        const coordinates = closeRing(points.slice(start, end));
        return {
          coordinates,
          area: signedArea(coordinates),
          bbox: ringBbox(coordinates),
          sourceIndex: index
        };
      }).filter(ring => ring.coordinates.length >= 4);
      shapes.push({recordNumber, rings});
    }
    offset = contentOffset + contentBytes;
  }
  return shapes;
}

export function buildOfficialFeatureCollection({rows, shapes, bbox = OFFICIAL_FLOOD_BBOX}) {
  const features = [];
  for (let index = 0; index < shapes.length; index++) {
    const row = rows[index];
    if (row === null) continue;
    const properties = row ?? {};
    const depth = depthClassForSegCode(properties.SEG_CODE);
    if (!depth) continue;
    for (const polygon of groupRings(shapes[index].rings)) {
      if (!bboxIntersects(polygon.bbox, bbox)) continue;
      features.push({
        type: 'Feature',
        id: `official-river-100-${properties.SEG_CODE || 'unknown'}-${features.length + 1}`,
        properties: {
          name: OFFICIAL_FLOOD_METADATA.title,
          depth_kind: 'interval',
          depth_min_m: depth.min,
          depth_max_m: depth.max,
          depth_m: depth.height,
          depth_label: depth.label,
          SEG_CODE: String(properties.SEG_CODE ?? ''),
          FLDLV_FREQ: properties.FLDLV_FREQ ?? 100,
          SGG_CD: String(properties.SGG_CD ?? '44210'),
          display_height_m: depth.height,
          depth_color: depth.color,
          source_kind: 'official_original_class'
        },
        geometry: {type: 'Polygon', coordinates: polygon.coordinates}
      });
    }
  }
  return {type: 'FeatureCollection', metadata: {...OFFICIAL_FLOOD_METADATA}, features};
}

export function depthClassForSegCode(value) {
  return DEPTH_CLASSES.get(String(value ?? '').trim()) ?? null;
}

export function validateOfficialProjection(buffer) {
  const text = typeof buffer === 'string' ? buffer : TEXT_DECODER.decode(toUint8(buffer));
  if (!/Transverse_Mercator|Transverse Mercator/i.test(text) || !/GRS_1980|GRS 1980|GRS80/i.test(text)) {
    throw Error('지원하는 EPSG:5186 계열 PRJ가 아닙니다');
  }
  if (!/central_meridian["\s,]+127/i.test(text) || !/latitude_of_origin["\s,]+38/i.test(text)) {
    throw Error('PRJ 중앙경선 또는 원점 위도가 예상과 다릅니다');
  }
  return true;
}

export function epsg5186ToLonLat(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw Error('EPSG:5186 좌표가 숫자가 아닙니다');
  const m = TM_M0 + (y - TM_FALSE_NORTHING) / TM_K0;
  const mu = m / (GRS80_A * (1 - TM_E2 / 4 - 3 * TM_E2 ** 2 / 64 - 5 * TM_E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - TM_E2)) / (1 + Math.sqrt(1 - TM_E2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sinPhi = Math.sin(phi1);
  const cosPhi = Math.cos(phi1);
  const tanPhi = Math.tan(phi1);
  const c1 = TM_EP2 * cosPhi ** 2;
  const t1 = tanPhi ** 2;
  const n1 = GRS80_A / Math.sqrt(1 - TM_E2 * sinPhi ** 2);
  const r1 = GRS80_A * (1 - TM_E2) / (1 - TM_E2 * sinPhi ** 2) ** 1.5;
  const d = (x - TM_FALSE_EASTING) / (n1 * TM_K0);
  const lat = phi1 - (n1 * tanPhi / r1) * (
    d ** 2 / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * TM_EP2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * TM_EP2 - 3 * c1 ** 2) * d ** 6 / 720
  );
  const lon = TM_LON0 + (
    d
    - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * TM_EP2 + 24 * t1 ** 2) * d ** 5 / 120
  ) / cosPhi;
  return [roundCoord(lon * 180 / Math.PI), roundCoord(lat * 180 / Math.PI)];
}

function officialBundle(entries) {
  const byExtension = new Map(entries.map(entry => [entry.extension, entry.data]));
  for (const extension of REQUIRED_EXTENSIONS) {
    if (!byExtension.has(extension)) throw Error(`공식 ZIP에 ${extension} 파일이 없습니다`);
  }
  return {
    shp: byExtension.get('.shp'),
    dbf: byExtension.get('.dbf'),
    prj: byExtension.get('.prj')
  };
}

async function inflateZipEntry(bytes, method) {
  if (method !== 8) throw Error(`지원하지 않는 ZIP 압축 방식입니다: ${method}`);
  if (typeof DecompressionStream === 'undefined') throw Error('이 브라우저는 ZIP 압축 해제를 지원하지 않습니다');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UNCOMPRESSED_BYTES) {
      await reader.cancel();
      throw Error('ZIP 압축 해제 크기가 허용 범위를 초과했습니다');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function findEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset--) {
    if (view.getUint32(offset, true) === ZIP_EOCD) return offset;
  }
  throw Error('ZIP 중앙 디렉터리를 찾지 못했습니다');
}

function groupRings(rings) {
  const enriched = rings.map((ring, index) => ({...ring, index, parent: -1, depth: 0}));
  for (const ring of enriched) {
    let parent = null;
    for (const candidate of enriched) {
      if (candidate === ring || Math.abs(candidate.area) <= Math.abs(ring.area)) continue;
      if (!bboxContains(candidate.bbox, ring.bbox)) continue;
      if (!pointInRing(ring.coordinates[0], candidate.coordinates)) continue;
      if (!parent || Math.abs(candidate.area) < Math.abs(parent.area)) parent = candidate;
    }
    ring.parent = parent ? parent.index : -1;
  }
  const byIndex = new Map(enriched.map(ring => [ring.index, ring]));
  for (const ring of enriched) {
    let depth = 0;
    let cursor = ring;
    while (cursor.parent >= 0) {
      depth++;
      cursor = byIndex.get(cursor.parent);
      if (!cursor) break;
    }
    ring.depth = depth;
  }
  return enriched
    .filter(ring => ring.depth % 2 === 0)
    .map(exterior => {
      const holes = enriched
        .filter(ring => ring.parent === exterior.index && ring.depth % 2 === 1)
        .sort((a, b) => a.sourceIndex - b.sourceIndex);
      const coordinates = [exterior.coordinates, ...holes.map(hole => hole.coordinates)];
      return {coordinates, bbox: exterior.bbox};
    });
}

function meridionalArc(phi) {
  return GRS80_A * (
    (1 - TM_E2 / 4 - 3 * TM_E2 ** 2 / 64 - 5 * TM_E2 ** 3 / 256) * phi
    - (3 * TM_E2 / 8 + 3 * TM_E2 ** 2 / 32 + 45 * TM_E2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * TM_E2 ** 2 / 256 + 45 * TM_E2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * TM_E2 ** 3 / 3072) * Math.sin(6 * phi)
  );
}

function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function bboxContains(a, b) {
  return a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
}

function ringBbox(coordinates) {
  return coordinates.reduce((bbox, point) => [
    Math.min(bbox[0], point[0]),
    Math.min(bbox[1], point[1]),
    Math.max(bbox[2], point[0]),
    Math.max(bbox[3], point[1])
  ], [Infinity, Infinity, -Infinity, -Infinity]);
}

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = ((yi > point[1]) !== (yj > point[1]))
      && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function closeRing(ring) {
  if (!ring.length) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) < 1e-12 && Math.abs(first[1] - last[1]) < 1e-12) return ring;
  return [...ring, [...first]];
}

function toUint8(buffer) {
  if (buffer instanceof Uint8Array) return buffer;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  throw Error('ArrayBuffer 입력이 필요합니다');
}

function slice(bytes, offset, length) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) throw Error('바이너리 범위가 잘못되었습니다');
  return bytes.subarray(offset, offset + length);
}

function extensionOf(name) {
  const clean = String(name).toLowerCase();
  const index = clean.lastIndexOf('.');
  return index >= 0 ? clean.slice(index) : '';
}

function numberOrText(value) {
  if (value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function roundCoord(value) {
  return Math.round(value * 1e12) / 1e12;
}

function shouldUseOfficialFloodWorker(fetcher) {
  return typeof window !== 'undefined'
    && typeof Worker !== 'undefined'
    && typeof globalThis.fetch === 'function'
    && fetcher === globalThis.fetch
    && !isOfficialFloodWorkerScope();
}

function isOfficialFloodWorkerScope() {
  return typeof WorkerGlobalScope !== 'undefined'
    && globalThis instanceof WorkerGlobalScope
    && typeof window === 'undefined';
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? Error('공식 침수 자료 처리가 취소되었습니다');
}

async function yieldIfAborted(signal) {
  throwIfAborted(signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  throwIfAborted(signal);
}
