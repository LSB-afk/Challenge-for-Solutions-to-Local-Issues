import test from 'node:test';
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import {
  OFFICIAL_FLOOD_DOWNLOAD,
  buildOfficialFeatureCollection,
  depthClassForSegCode,
  epsg5186ToLonLat,
  loadOfficialFlood,
  loadOfficialFloodInWorker,
  officialDownloadRequest,
  parseDbf,
  parseShp,
  parseZipEntries,
  validateOfficialProjection
} from '../dist/flood-official.js';

const prj = `PROJCS["Korea_2000_Korea_Central_Belt_2010",GEOGCS["GCS_Korea_2000",DATUM["D_Korea_2000",SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",127],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",600000],UNIT["Meter",1]]`;

test('공식 다운로드 요청은 서산 100년 지방하천 파일 메타데이터를 그대로 보낸다', () => {
  const request = officialDownloadRequest();
  assert.equal(request.url, 'https://data.floodmap.go.kr/api/shp/download');
  assert.equal(request.method, 'POST');
  assert.equal(request.body.get('fileEngNm'), 'RFM_SGG_RGN_44210_100.zip');
  assert.equal(request.body.get('fileKorNm'), '행정구역 충청남도 서산시 100년 빈도 지방하천 하천범람지도.zip');
  assert.equal(request.body.get('dataNm'), '행정구역별 100년 빈도 지방하천 하천범람지도');
  assert.equal(OFFICIAL_FLOOD_DOWNLOAD.infoUpdtYm, '202512');
});

test('ZIP 중앙 디렉터리와 바이너리 범위가 잘못되면 거부한다', async () => {
  await assert.rejects(() => parseZipEntries(new Uint8Array([1, 2, 3, 4]).buffer), /중앙 디렉터리/);
  const bad = makeStoredZip([{name: 'x.shp', data: new Uint8Array([1, 2, 3])}], {truncateLocalData: true});
  await assert.rejects(() => parseZipEntries(bad.buffer), /중앙 디렉터리|범위|크기/);
});

test('저장 방식 ZIP에서 필요한 SHP 보조 파일만 추출한다', async () => {
  const zip = makeStoredZip([
    {name: 'readme.txt', data: text('ignore')},
    {name: 'sample.prj', data: text(prj)},
    {name: 'sample.dbf', data: makeDbf([{SEG_CODE: 'N330', FLDLV_FREQ: '100', SGG_CD: '44210'}])}
  ]);
  const entries = await parseZipEntries(zip.buffer);
  assert.deepEqual(entries.map(entry => entry.extension).sort(), ['.dbf', '.prj']);
});

test('DBF 레코드를 필드명 기준으로 매핑한다', () => {
  const rows = parseDbf(makeDbf([
    {SEG_CODE: 'N330', FLDLV_FREQ: '100', SGG_CD: '44210'},
    {SEG_CODE: 'N332', FLDLV_FREQ: '100', SGG_CD: '44210'}
  ]));
  assert.deepEqual(rows, [
    {SEG_CODE: 'N330', FLDLV_FREQ: 100, SGG_CD: '44210'},
    {SEG_CODE: 'N332', FLDLV_FREQ: 100, SGG_CD: '44210'}
  ]);
});

test('DBF 삭제 레코드는 SHP 인덱스 보존을 위해 null 자리표시자로 남긴다', () => {
  const dbf = new Uint8Array(makeDbf([
    {SEG_CODE: 'N330', FLDLV_FREQ: '100', SGG_CD: '44210'},
    {SEG_CODE: 'N331', FLDLV_FREQ: '100', SGG_CD: '44210'},
    {SEG_CODE: 'N332', FLDLV_FREQ: '100', SGG_CD: '44210'}
  ]));
  const headerLength = new DataView(dbf.buffer).getUint16(8, true);
  const recordLength = new DataView(dbf.buffer).getUint16(10, true);
  dbf[headerLength + recordLength] = 0x2a;
  const rows = parseDbf(dbf);
  assert.equal(rows.length, 3);
  assert.equal(rows[1], null);
  assert.equal(rows[2].SEG_CODE, 'N332');
});

test('EPSG:5186 역변환은 원점과 주변 기준점을 안정적으로 계산한다', () => {
  assertApprox(epsg5186ToLonLat(200000, 600000), [127, 38]);
  assertApprox(epsg5186ToLonLat(199900, 599900), [126.998861482697, 37.999099065064]);
  assertApprox(epsg5186ToLonLat(200100, 600100), [127.00113854516, 38.00090092406]);
  assertApprox(epsg5186ToLonLat(199750, 600150), [126.997153619689, 38.001351359788]);
});

test('SHP 폴리곤 파서는 다중 파트와 구멍 후보 링을 보존한다', () => {
  const shapes = parseShp(makeShp([{
    parts: [
      squareMeters(199800, 599800, 200200, 600200),
      squareMeters(199920, 599920, 200080, 600080),
      squareMeters(210000, 610000, 210200, 610200)
    ]
  }]));
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].rings.length, 3);
  assert.equal(shapes[0].rings[0].coordinates.length, 5);
  assert.ok(shapes[0].rings[0].bbox[0] < 127);
});

test('공식 수심 구간은 정확 수심으로 둔갑하지 않고 구간 필드를 우선 제공한다', () => {
  const rows = [{SEG_CODE: 'N330', FLDLV_FREQ: 100, SGG_CD: 44210}, {SEG_CODE: 'N334', FLDLV_FREQ: 100, SGG_CD: 44210}];
  const shapes = parseShp(makeShp([
    {parts: [squareMeters(199800, 599800, 200200, 600200)]},
    {parts: [squareMeters(199700, 599700, 200300, 600300)]}
  ]));
  const collection = buildOfficialFeatureCollection({rows, shapes, bbox: [126.99, 37.99, 127.01, 38.01]});
  assert.equal(collection.metadata.kind, 'official');
  assert.equal(collection.metadata.license, '공공누리 제4유형');
  assert.equal(collection.features.length, 2);
  assert.equal(collection.features[0].properties.depth_kind, 'interval');
  assert.equal(collection.features[0].properties.depth_min_m, 0);
  assert.equal(collection.features[0].properties.depth_max_m, 0.5);
  assert.equal(collection.features[0].properties.depth_m, 0.5);
  assert.equal(collection.features[0].properties.depth_label, '0.5 m 미만');
  assert.equal(collection.features[1].properties.depth_max_m, null);
  assert.equal(collection.features[1].properties.display_height_m, 5);
  assert.equal(depthClassForSegCode('N332').label, '1-2 m');
});

test('PRJ가 EPSG:5186 계열이 아니면 실패한다', () => {
  assert.equal(validateOfficialProjection(prj), true);
  assert.throws(() => validateOfficialProjection('GEOGCS["WGS 84"]'), /EPSG:5186/);
});

test('브라우저 기본 경로는 공식 파싱을 module Worker로 넘기고 진행률을 중계한다', async () => {
  const original = captureGlobals(['window', 'Worker', 'fetch']);
  const progress = [];
  const workers = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = String(url);
      this.options = options;
      this.messages = [];
      workers.push(this);
    }
    postMessage(message) {
      this.messages.push(message);
      queueMicrotask(() => {
        this.onmessage({data: {type: 'progress', progress: {stage: 'parsed', message: 'done'}}});
        this.onmessage({data: {type: 'result', collection: {type: 'FeatureCollection', metadata: {kind: 'official'}, features: []}}});
      });
    }
    terminate() {
      this.terminated = true;
    }
  }
  try {
    globalThis.window = {};
    globalThis.Worker = FakeWorker;
    const fetcher = async () => { throw Error('worker path should not fetch on main thread'); };
    globalThis.fetch = fetcher;
    const collection = await loadOfficialFlood({onProgress: item => progress.push(item)});
    assert.equal(collection.metadata.kind, 'official');
    assert.equal(workers.length, 1);
    assert.match(workers[0].url, /flood-official-worker\.js$/);
    assert.equal(workers[0].options.type, 'module');
    assert.deepEqual(workers[0].messages, [{type: 'load'}]);
    assert.equal(workers[0].terminated, true);
    assert.equal(progress[0].stage, 'parsed');
  } finally {
    restoreGlobals(original);
  }
});

test('Worker 경로는 취소 시 terminate하고 rejection을 반환한다', async () => {
  const controller = new AbortController();
  const workers = [];
  class HangingWorker {
    constructor() {
      workers.push(this);
    }
    postMessage(message) {
      this.message = message;
    }
    terminate() {
      this.terminated = true;
    }
  }
  const promise = loadOfficialFloodInWorker({signal: controller.signal, WorkerCtor: HangingWorker});
  controller.abort(Error('사용자 취소'));
  await assert.rejects(promise, /사용자 취소/);
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(workers[0].message, {type: 'load'});
});

test('주입 fetcher 경로는 Worker 없이 기존 코어 로더를 유지한다', async () => {
  const original = captureGlobals(['window', 'Worker']);
  try {
    globalThis.window = {};
    globalThis.Worker = class {
      constructor() {
        throw Error('custom fetcher should bypass worker');
      }
    };
    const rows = [{SEG_CODE: 'N330', FLDLV_FREQ: 100, SGG_CD: '44210'}];
    const zip = makeOfficialStoredZip({rows, meterShapes: [{parts: [squareMeters(167100, 465700, 167300, 465900)]}]});
    const collection = await loadOfficialFlood({
      fetcher: async () => ({ok: true, arrayBuffer: async () => zip.buffer})
    });
    assert.equal(collection.metadata.kind, 'official');
    assert.equal(collection.features.length, 1);
  } finally {
    restoreGlobals(original);
  }
});

test('로컬 공식 원본 ZIP은 저장소에 묶지 않고 있을 때만 회귀 확인한다', async t => {
  const path = '../tmp/research/floodmap-official/RFM_SGG_RGN_44210_100.zip';
  try {
    await access(path);
  } catch {
    t.skip('로컬 공식 ZIP fixture 없음');
    return;
  }
  const entries = await parseZipEntries(await readFile(path));
  const byExtension = new Map(entries.map(entry => [entry.extension, entry.data]));
  validateOfficialProjection(byExtension.get('.prj'));
  const rows = parseDbf(byExtension.get('.dbf'));
  const shapes = parseShp(byExtension.get('.shp'));
  const collection = buildOfficialFeatureCollection({rows, shapes});
  assert.equal(rows.length, shapes.length);
  assert.ok(collection.features.length > 0);
  assert.ok(collection.features.every(feature => feature.properties.depth_kind === 'interval'));
  assert.ok(collection.features.every(feature => feature.geometry.type === 'Polygon'));
});

function assertApprox(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(Math.abs(actual[index] - expected[index]) < 1e-9, `${actual[index]} ~= ${expected[index]}`);
  }
}

function text(value) {
  return new TextEncoder().encode(value);
}

function makeDbf(rows) {
  const fields = [
    {name: 'SEG_CODE', type: 'C', length: 8},
    {name: 'FLDLV_FREQ', type: 'N', length: 8},
    {name: 'SGG_CD', type: 'C', length: 8}
  ];
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const headerLength = 32 + fields.length * 32 + 1;
  const bytes = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x03;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  fields.forEach((field, index) => {
    const offset = 32 + index * 32;
    bytes.set(text(field.name).slice(0, 11), offset);
    bytes[offset + 11] = field.type.charCodeAt(0);
    bytes[offset + 16] = field.length;
  });
  bytes[headerLength - 1] = 0x0d;
  rows.forEach((row, rowIndex) => {
    let offset = headerLength + rowIndex * recordLength;
    bytes[offset++] = 0x20;
    for (const field of fields) {
      const value = String(row[field.name] ?? '').padEnd(field.length, ' ').slice(0, field.length);
      bytes.set(text(value), offset);
      offset += field.length;
    }
  });
  bytes[bytes.length - 1] = 0x1a;
  return bytes.buffer;
}

function makeOfficialStoredZip({rows, meterShapes}) {
  const shp = makeShp(meterShapes);
  return makeStoredZip([
    {name: 'RFM_SGG_RGN_44210_100.prj', data: text(prj)},
    {name: 'RFM_SGG_RGN_44210_100.dbf', data: makeDbf(rows)},
    {name: 'RFM_SGG_RGN_44210_100.shp', data: new Uint8Array(shp)}
  ]);
}

function captureGlobals(keys) {
  return Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
}

function restoreGlobals(original) {
  for (const [key, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

function makeShp(records) {
  const contents = records.map(record => {
    const numParts = record.parts.length;
    const points = record.parts.flat();
    const contentBytes = 44 + numParts * 4 + points.length * 16;
    const bytes = new Uint8Array(contentBytes);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, 5, true);
    const bbox = points.reduce((box, [x, y]) => [
      Math.min(box[0], x),
      Math.min(box[1], y),
      Math.max(box[2], x),
      Math.max(box[3], y)
    ], [Infinity, Infinity, -Infinity, -Infinity]);
    bbox.forEach((value, index) => view.setFloat64(4 + index * 8, value, true));
    view.setInt32(36, numParts, true);
    view.setInt32(40, points.length, true);
    let cursor = 44;
    let pointIndex = 0;
    for (const part of record.parts) {
      view.setInt32(cursor, pointIndex, true);
      cursor += 4;
      pointIndex += part.length;
    }
    for (const [x, y] of points) {
      view.setFloat64(cursor, x, true);
      view.setFloat64(cursor + 8, y, true);
      cursor += 16;
    }
    return bytes;
  });
  const totalLength = 100 + records.length * 8 + contents.reduce((sum, content) => sum + content.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, totalLength / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 5, true);
  let offset = 100;
  contents.forEach((content, index) => {
    view.setInt32(offset, index + 1, false);
    view.setInt32(offset + 4, content.byteLength / 2, false);
    bytes.set(content, offset + 8);
    offset += 8 + content.byteLength;
  });
  return bytes.buffer;
}

function squareMeters(x1, y1, x2, y2) {
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
}

function makeStoredZip(files, options = {}) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralOffset = offset;
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralOffset, true);
  const total = offset + centralSize + eocd.length - (options.truncateLocalData ? 2 : 0);
  const zip = new Uint8Array(total);
  let cursor = 0;
  for (const local of locals) {
    zip.set(local.subarray(0, Math.min(local.length, zip.length - cursor)), cursor);
    cursor += local.length;
  }
  for (const central of centrals) {
    if (cursor >= zip.length) break;
    zip.set(central.subarray(0, Math.min(central.length, zip.length - cursor)), cursor);
    cursor += central.length;
  }
  if (cursor < zip.length) zip.set(eocd.subarray(0, zip.length - cursor), cursor);
  return zip;
}
