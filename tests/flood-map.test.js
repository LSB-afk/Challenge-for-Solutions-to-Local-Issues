import test from 'node:test';
import assert from 'node:assert/strict';
import {FloodMap} from '../dist/flood-map.js';

const line = (id, impact = 'outside') => ({
  type: 'Feature',
  id,
  properties: {osmId: id, name: `도로 ${id}`, impact, depth_m: 0.4},
  geometry: {type: 'LineString', coordinates: [[126.6, 36.76], [126.61, 36.77]]}
});
const polygon = depth => ({
  type: 'Feature',
  properties: {depth_m: depth},
  geometry: {type: 'Polygon', coordinates: [[[126.6, 36.76], [126.61, 36.76], [126.61, 36.77], [126.6, 36.76]]]}
});
const officialInterval = () => ({
  type: 'Feature',
  id: 'official-1',
  properties: {
    depth_kind: 'interval',
    depth_min_m: 2,
    depth_max_m: null,
    depth_label: '5 m 이상',
    depth_m: 5,
    display_height_m: 2.4,
    depth_color: '#123abc'
  },
  geometry: {type: 'Polygon', coordinates: [[[126.6, 36.76], [126.61, 36.76], [126.61, 36.77], [126.6, 36.76]]]}
});
const collection = features => ({type: 'FeatureCollection', features});

class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.textContent = '';
    this.dataset = {};
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, fn) { this[`on${name}`] = fn; }
}

function installDom() {
  const original = Object.fromEntries(['window', 'document', 'fetch', 'ResizeObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const map = new FakeNode('div');
  const fallback = new FakeNode('div');
  globalThis.document = {
    readyState: 'complete',
    querySelector(selector) { return selector === '#map' ? map : fallback; },
    createElement(tag) { return new FakeNode(tag); },
    createElementNS(ns, tag) { return new FakeNode(tag); }
  };
  globalThis.window = {matchMedia: () => ({matches: false}), addEventListener() {}};
  globalThis.ResizeObserver = class { observe() {} };
  return {
    map,
    fallback,
    restore() {
      for (const [key, descriptor] of Object.entries(original)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  };
}

test('지도 엔진이 없으면 수심 자료와 공개 도로를 도식으로 계속 표시한다', async () => {
  const dom = installDom();
  const status = [];
  try {
    const map = new FloodMap({
      container: '#map',
      fallbackContainer: '#fallback',
      onStatus: value => status.push(value)
    });
    await map.init({
      roads: collection([line(1, 'excluded')]),
      places: [{id: 'p1', name: '원평리 마을회관', coordinate: {lon: 126.605, lat: 36.765}}]
    });
    map.update({depths: collection([officialInterval()]), verticalScale: 3});
    assert.equal(map.fallback, true);
    assert.equal(dom.map.hidden, true);
    assert.equal(dom.fallback.hidden, false);
    assert.equal(status.at(-1).mode, 'diagram');
    assert.equal(dom.fallback.children[0].getAttribute('aria-label'), '수심 자료 도식 · 수직 표시 배율 3배');
    assert.equal(dom.fallback.children[0].children[1].getAttribute('fill'), '#123abc');
    assert.equal(dom.fallback.children[0].children[1].getAttribute('aria-label'), '5 m 이상');
    assert.match(dom.fallback.children[0].children.at(-1).textContent, /실제 안전 경로 아님/);
  } finally {
    dom.restore();
  }
});

test('MapLibre 모드에서 수심 배율은 extrusion 높이만 갱신하고 도로·경로 소스를 보존한다', async () => {
  const dom = installDom();
  const instances = [];
  class StubMap {
    constructor(options) {
      this.options = options;
      this.sources = new Map();
      this.layers = new Set();
      this.paint = new Map();
      this.layout = new Map();
      instances.push(this);
    }
    addControl() {}
    once(name, fn) { if (name === 'load') queueMicrotask(fn); }
    on() {}
    addSource(id, source) { this.sources.set(id, {data: source.data, setData(data) { this.data = data; }}); }
    getSource(id) { return this.sources.get(id); }
    addLayer(layer) { this.layers.add(layer.id); if (layer.paint) this.paint.set(layer.id, layer.paint); }
    getLayer(id) { return this.layers.has(id); }
    setPaintProperty(id, prop, value) { this.paint.set(`${id}:${prop}`, value); }
    setLayoutProperty(id, prop, value) { this.layout.set(`${id}:${prop}`, value); }
    fitBounds(bounds) { this.bounds = bounds; }
    easeTo(options) { this.camera = options; }
    getZoom() { return 13; }
    zoomTo(zoom) { this.zoom = zoom; }
    getCanvas() { return {style: {}}; }
    remove() { this.removed = true; }
  }
  globalThis.window.maplibregl = {Map: StubMap, ScaleControl: class {}};
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('openfreemap')) return {ok: true, json: async () => ({version: 8, sources: {}, layers: [{id: 'background', type: 'background'}]})};
    if (options.body?.get?.('returnIdsOnly') === 'true') return {ok: true, json: async () => ({objectIds: [1]})};
    if (options.body?.get?.('objectIds') === '1') return {
      ok: true,
      json: async () => collection([{
        type: 'Feature',
        id: 1,
        properties: {objectid: 1, gro_flo_co: 2, building_name: null},
        geometry: {type: 'Polygon', coordinates: [[[126.6, 36.76], [126.601, 36.76], [126.601, 36.761], [126.6, 36.76]]]}
      }])
    };
    return {ok: false};
  };
  try {
    const buildings = [];
    const map = new FloodMap({
      container: '#map',
      fallbackContainer: '#fallback',
      onBuildings: value => buildings.push(value)
    });
    map.update({depths: collection([officialInterval()]), verticalScale:10, showFlood:false, showBuildings:false, building3d:false});
    await map.init({roads: collection([line(7)]), places: []});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(map.verticalScale,10);
    assert.equal(map.showFlood,false);
    assert.equal(map.showBuildings,false);
    assert.equal(map.building3d,false);
    await new Promise(resolve => setImmediate(resolve));
    map.update({
      depths: collection([officialInterval()]),
      exposure: collection([{...line(7, 'depth-review'), properties: {...line(7).properties, impact: 'depth-review', depth_m: null}}]),
      route: {
        after: {status: 'candidate', coordinates: [[126.599, 36.759], [126.6, 36.76], [126.61, 36.77], [126.612, 36.772]]},
        before: {status: 'no-path', coordinates: []},
        snaps: {origin: {point: [126.6, 36.76], distanceM: 120}, destination: {point: [126.61, 36.77], distanceM: 160}}
      },
      verticalScale: 4,
      showBuildings: false
    });
    const stub = instances[0];
    assert.equal(stub.getSource('f-depths').data.features[0].properties.display_height_m, 2.4);
    assert.equal(stub.getSource('f-depths').data.features[0].properties.depth_label, '5 m 이상');
    assert.equal(stub.getSource('f-roads').data.features[0].properties.impact, 'depth-review');
    assert.equal(stub.getSource('f-roads').data.features[0].properties.depth_m, null);
    assert.deepEqual(stub.getSource('f-route').data.features.map(f => f.properties.kind), ['main', 'connector', 'connector']);
    assert.deepEqual(stub.getSource('f-route').data.features[0].geometry.coordinates, [[126.6, 36.76], [126.61, 36.77]]);
    assert.deepEqual(stub.paint.get('f-depth-extrusion:fill-extrusion-height').at(-1), 4);
    assert.ok(JSON.stringify(stub.paint.get('f-depth-extrusion:fill-extrusion-height')).includes('display_height_m'));
    assert.equal(stub.layout.get('f-buildings-fill:visibility'), 'none');
    assert.equal(buildings.at(-1).status, 'ready');
  } finally {
    dom.restore();
  }
});

test('지도 잠금은 모든 입력 방식을 막고 해제하며 카메라 좌표를 전달한다', () => {
  const dom=installDom(),camera=[];
  try {
    const renderer=new FloodMap({container:'#map',fallbackContainer:'#fallback',onCamera:value=>camera.push(value)});
    const calls=[];
    const interactions=Object.fromEntries(['dragPan','scrollZoom','boxZoom','dragRotate','keyboard','doubleClickZoom','touchZoomRotate','touchPitch'].map(key=>[key,{disable(){calls.push(`${key}:off`);},enable(){calls.push(`${key}:on`);}}]));
    renderer.map={...interactions,getCenter:()=>({lng:126.63,lat:36.77}),getBearing:()=>-18,getPitch:()=>58,getZoom:()=>15};
    renderer.setLocked(true);assert.equal(renderer.locked,true);assert.equal(calls.filter(x=>x.endsWith(':off')).length,8);
    renderer.setLocked(false);assert.equal(renderer.locked,false);assert.equal(calls.filter(x=>x.endsWith(':on')).length,8);
    renderer.emitCamera();assert.deepEqual(camera[0],{lon:126.63,lat:36.77,bearing:-18,pitch:58,zoom:15});
    renderer.map=null;assert.doesNotThrow(()=>renderer.setLocked(true));
  } finally {dom.restore();}
});

test('지도 표식은 원본 구간 표기를 유지하고 갱신·숨김 때 이전 표식을 제거한다', () => {
  const dom=installDom(),created=[],selected=[];
  try {
    window.maplibregl={Marker:class{
      constructor(options){this.element=options.element;created.push(this);}
      setLngLat(point){this.point=point;return this;}addTo(){return this;}remove(){this.removed=true;}
    }};
    const renderer=new FloodMap({container:'#map',fallbackContainer:'#fallback',onDepth:f=>selected.push(f)});
    renderer.map={};renderer.depthLabelKind='공식 등급';
    renderer.current={depths:collection([officialInterval()]),exposure:collection([line(7,'bridge-review')])};
    renderer.updateAnnotations();assert.equal(created.length,2);
    assert.equal(created[0].element.children[1].textContent,'5 m 이상');
    assert.equal(created[0].element.children[2].textContent,'공식 등급');
    created[0].element.onclick();assert.equal(selected[0].id,'official-1');
    renderer.showFlood=false;renderer.updateAnnotations();
    assert.ok(created[0].removed && created[1].removed);assert.equal(renderer.annotations.length,1);
    renderer.showLabels=false;renderer.updateAnnotations();assert.equal(renderer.annotations.length,0);assert.ok(created.at(-1).removed);
  } finally {dom.restore();}
});

test('도식 모드에서도 수심·도로 레이어 선택이 유지된다', async () => {
  const dom=installDom();
  try {
    const renderer=new FloodMap({container:'#map',fallbackContainer:'#fallback'});
    await renderer.init({roads:collection([line(1)]),places:[]});
    renderer.update({depths:collection([polygon(.5)]),showRoads:false});
    assert.equal(dom.fallback.children[0].children.filter(n=>n.tagName==='polyline').length,0);
    assert.equal(dom.fallback.children[0].children.filter(n=>n.tagName==='path').length,1);
    renderer.update({depths:collection([polygon(.5)]),showFlood:false,showRoads:true});
    assert.equal(dom.fallback.children[0].children.filter(n=>n.tagName==='path').length,0);
    assert.equal(dom.fallback.children[0].children.filter(n=>n.tagName==='polyline').length,1);
  } finally {dom.restore();}
});
