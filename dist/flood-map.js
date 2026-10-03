import {BUILDING_SOURCE_URL, buildingSummary, loadOfficialBuildings} from './buildings.js';
import {DEPTH_BANDS, depthColor} from './flood-analysis.js';

const CENTER = [126.6203, 36.7691];
const TARGET_BOUNDS = [[126.595, 36.745], [126.645, 36.795]];
const SVG_NS = 'http://www.w3.org/2000/svg';
const COLLECTION = features => ({type: 'FeatureCollection', features});
const EMPTY = COLLECTION([]);
const DEPTH_INPUT = ['to-number', ['get', 'depth_m'], 0];
const HEIGHT_INPUT = ['to-number', ['coalesce', ['get', 'display_height_m'], ['get', 'depth_m'], 0], 0];
const DEPTH_STEP_COLOR = ['step', DEPTH_INPUT, DEPTH_BANDS[0].color, ...DEPTH_BANDS.slice(1).flatMap(band => [band.min, band.color])];
const DEPTH_COLOR = ['case', ['has', 'depth_color'], ['get', 'depth_color'], DEPTH_STEP_COLOR];
const ROAD_COLOR = [
  'match', ['get', 'impact'],
  'outside', '#9aa8b2',
  'below', '#77a9b6',
  'excluded', '#d14d37',
  'depth-review', '#e08a22',
  'bridge-review', '#c59020',
  '#9aa8b2'
];
const STATUS_LABELS = {
  outside: '침수 범위 밖',
  below: '기준 이하',
  excluded: '통행 제약 후보',
  'depth-review': '수심 구간 확인 필요',
  'bridge-review': '교량 확인 필요'
};

function cloneFeature(feature, index = 0) {
  const properties = {...(feature?.properties ?? {})};
  const id = feature?.id ?? properties.id ?? properties.roadId ?? properties.osmId ?? `road-${index + 1}`;
  properties.__flood_id = String(id);
  return {
    type: 'Feature',
    id,
    properties,
    geometry: structuredClone(feature.geometry)
  };
}

function isFeatureCollection(value) {
  return value?.type === 'FeatureCollection' && Array.isArray(value.features);
}

function finitePoint(point) {
  return Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function validLine(feature) {
  return feature?.geometry?.type === 'LineString' && Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length >= 2 && feature.geometry.coordinates.every(finitePoint);
}

function validPolygon(feature) {
  const type = feature?.geometry?.type;
  return (type === 'Polygon' || type === 'MultiPolygon') && Number.isFinite(Number(feature.properties?.depth_m));
}

function normalizeDepthFeature(feature, index) {
  const cloned = cloneFeature(feature, index);
  const depth = Number(feature.properties.depth_m);
  cloned.properties = {...feature.properties, __flood_id: cloned.properties.__flood_id, depth_m: depth};
  if (Number.isFinite(Number(feature.properties.display_height_m))) cloned.properties.display_height_m = Number(feature.properties.display_height_m);
  if (typeof feature.properties.depth_color !== 'string' || !/^#[0-9a-f]{6}$/i.test(feature.properties.depth_color)) delete cloned.properties.depth_color;
  if (feature.properties.depth_label !== undefined) cloned.properties.depth_label = String(feature.properties.depth_label);
  return cloned;
}

function featureId(feature) {
  return String(feature?.properties?.__flood_id ?? feature?.id ?? feature?.properties?.id ?? feature?.properties?.roadId ?? feature?.properties?.osmId ?? '');
}

function firstSymbolLayer(style) {
  return style.layers?.find(layer => layer.type === 'symbol')?.id;
}

function disableNativeBuildings(style) {
  const next = structuredClone(style);
  for (const layer of next.layers ?? []) {
    if (layer.type === 'fill-extrusion' || layer['source-layer'] === 'building' || /building/i.test(layer.id)) {
      layer.layout = {...layer.layout, visibility: 'none'};
    }
    if (layer.type === 'background') layer.paint = {...layer.paint, 'background-color': '#f8fafb'};
  }
  return next;
}

function fallbackStyle() {
  return {
    version: 8,
    name: 'Unsan light fallback',
    sources: {},
    layers: [{id: 'background', type: 'background', paint: {'background-color': '#f8fafb'}}],
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
  };
}

function safeCollection(value, predicate, normalizer = feature => feature) {
  if (!isFeatureCollection(value)) return EMPTY;
  return COLLECTION(value.features.filter(predicate).map(normalizer));
}

function boundsFor(features) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = point => {
    if (!finitePoint(point)) return;
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
  };
  const walk = coordinates => {
    if (!Array.isArray(coordinates)) return;
    if (finitePoint(coordinates)) visit(coordinates);
    else coordinates.forEach(walk);
  };
  for (const feature of features) walk(feature.geometry?.coordinates);
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : TARGET_BOUNDS;
}

function distancePoint(a, b) {
  if (!finitePoint(a) || !finitePoint(b)) return 0;
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * 111320 * Math.cos(lat);
  const dy = (b[1] - a[1]) * 110540;
  return Math.hypot(dx, dy);
}

function pathDistance(coordinates = []) {
  return coordinates.slice(1).reduce((sum, point, index) => sum + distancePoint(coordinates[index], point), 0);
}

function routeFeature(kind, phase, coordinates, extra = {}) {
  return {
    type: 'Feature',
    properties: {kind, phase, ...extra},
    geometry: {type: 'LineString', coordinates}
  };
}

function samePoint(a, b) {
  return finitePoint(a) && finitePoint(b) && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function splitRoute(item, snaps) {
  const coordinates = item?.coordinates ?? [];
  if (item?.status !== 'candidate' || !coordinates.every(finitePoint) || coordinates.length < 2) return {main: [], connectors: []};
  const originSnap = snaps?.origin?.point;
  const destinationSnap = snaps?.destination?.point;
  let start = originSnap ? coordinates.findIndex(point => samePoint(point, originSnap)) : 0;
  let end = destinationSnap ? coordinates.findLastIndex(point => samePoint(point, destinationSnap)) : coordinates.length - 1;
  if (start < 0) start = 0;
  if (end < start) end = coordinates.length - 1;
  const connectors = [];
  if (originSnap && start > 0 && !samePoint(coordinates[0], originSnap)) connectors.push([coordinates[0], originSnap]);
  if (destinationSnap && end < coordinates.length - 1 && !samePoint(destinationSnap, coordinates.at(-1))) connectors.push([destinationSnap, coordinates.at(-1)]);
  return {main: coordinates.slice(start, end + 1), connectors};
}

function routeFeatures(route) {
  const features = [];
  for (const phase of ['before', 'after']) {
    const item = route?.[phase];
    if (!item) continue;
    const split = splitRoute(item, route?.snaps);
    if (!split.main.length && !split.connectors.length) continue;
    const base = {status: item.status ?? 'candidate', distanceM: item.distanceM ?? pathDistance(item.coordinates)};
    if (split.main.length >= 2) features.push(routeFeature('main', phase, split.main, base));
    for (const coordinates of split.connectors) features.push(routeFeature('connector', phase, coordinates));
  }
  return features;
}

function placePoint(place) {
  const coordinate = place?.coordinate;
  if (coordinate && Number.isFinite(coordinate.lon) && Number.isFinite(coordinate.lat)) return [coordinate.lon, coordinate.lat];
  if (finitePoint(place?.coordinates)) return place.coordinates;
  return null;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function setLayerVisibility(map, id, visible) {
  if (map?.getLayer?.(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

export class FloodMap {
  constructor({
    container,
    fallbackContainer,
    onDepth = () => {},
    onRoad = () => {},
    onPlace = () => {},
    onStatus = () => {},
    onBuildings = () => {},
    onCamera = () => {}
  }) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.fallbackContainer = typeof fallbackContainer === 'string' ? document.querySelector(fallbackContainer) : fallbackContainer;
    this.onDepth = onDepth;
    this.onRoad = onRoad;
    this.onPlace = onPlace;
    this.onStatus = onStatus;
    this.onBuildings = onBuildings;
    this.onCamera = onCamera;
    this.showRoads = true;
    this.showLabels = true;
    this.locked = false;
    this.annotations = [];
    this.view = '3d';
    this.verticalScale = 1;
    this.showFlood = true;
    this.showBuildings = true;
    this.building3d = true;
    this.ready = false;
    this.fallback = false;
    this.markers = [];
    this.roadOriginals = new Map();
    this.current = {depths: EMPTY, exposure: EMPTY, route: null};
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.map?.resize?.());
  }

  async init({roads, places} = {}) {
    this.places = Array.isArray(places) ? places : [];
    this.roads = await this.loadRoads(roads);
    this.roadOriginals.clear();
    for (const feature of this.roads.features) this.roadOriginals.set(featureId(feature), feature);
    try {
      if (!this.container) throw Error('missing map container');
      if (!globalThis.window?.maplibregl && document.readyState !== 'complete') {
        await new Promise(resolve => window.addEventListener('load', resolve, {once: true}));
      }
      if (!globalThis.window?.maplibregl) throw Error('missing maplibre');
      const style = await this.loadStyle();
      this.createMap(style);
    } catch (error) {
      this.showFallback(error?.message || '지도 엔진을 사용할 수 없습니다.');
    }
  }

  async loadRoads(roads) {
    if (isFeatureCollection(roads)) return safeCollection(roads, validLine, cloneFeature);
    try {
      const response = await fetch('./data/unsan-osm-roads.geojson', {signal: AbortSignal.timeout(12000), credentials: 'omit'});
      if (!response.ok) throw Error('roads unavailable');
      return safeCollection(await response.json(), validLine, cloneFeature);
    } catch {
      return EMPTY;
    }
  }

  async loadStyle() {
    try {
      const response = await fetch('https://tiles.openfreemap.org/styles/liberty', {signal: AbortSignal.timeout(12000), credentials: 'omit'});
      if (!response.ok) throw Error('style unavailable');
      return disableNativeBuildings(await response.json());
    } catch {
      return fallbackStyle();
    }
  }

  createMap(style) {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.map = new window.maplibregl.Map({
      container: this.container,
      style,
      center: CENTER,
      zoom: 13.1,
      pitch: this.view === '3d' ? 58 : 0,
      bearing: this.view === '3d' ? -18 : 0,
      minZoom: 10,
      maxZoom: 19,
      maxPitch: 72,
      attributionControl: {compact: true},
      fadeDuration: reduced ? 0 : 160
    });
    this.map.addControl?.(new window.maplibregl.ScaleControl({maxWidth: 100, unit: 'metric'}), 'bottom-left');
    this.loadTimer = setTimeout(() => {
      if (!this.ready) this.showFallback('지도 로드가 지연되어 도식 모드로 전환했습니다.');
    }, 18000);
    this.map.once('load', () => {
      if (this.fallback) return;
      try {
        this.addLayers(style);
        this.addPlaceMarkers();
        this.attachMapEvents();
        this.ready = true;
        this.update({...this.current, verticalScale:this.verticalScale, showFlood:this.showFlood, showBuildings:this.showBuildings, building3d:this.building3d, showRoads:this.showRoads, showLabels:this.showLabels});
        this.setLocked(this.locked);
        this.focusDepths();
        this.resizeObserver?.observe(this.container);
        this.loadBuildings();
        // MapLibre starts compact attribution expanded; use its own toggle on small screens.
        if (window.innerWidth <= 600) this.container.querySelector?.('.maplibregl-compact-show .maplibregl-ctrl-attrib-button')?.click();
        clearTimeout(this.loadTimer);
        this.onStatus({ready: true, mode: this.view, message: '수심 자료와 공개 도로 형상을 표시합니다.'});
      } catch (error) {
        this.showFallback(error?.message || '지도 레이어 구성에 실패했습니다.');
      }
    });
    this.map.on?.('move', () => this.emitCamera());
    this.map.on?.('moveend', () => this.layoutAnnotations());
    this.map.on?.('resize', () => this.layoutAnnotations());
    this.map.on?.('error', event => {
      if (!this.ready && event?.error?.message?.includes?.('WebGL')) this.showFallback('WebGL을 사용할 수 없어 도식 모드로 전환했습니다.');
    });
  }

  addLayers(style) {
    const map = this.map;
    const before = firstSymbolLayer(style);
    map.addSource('f-depths', {type: 'geojson', data: EMPTY});
    map.addSource('f-roads', {type: 'geojson', data: this.roads});
    map.addSource('f-route', {type: 'geojson', data: EMPTY});
    map.addLayer({id: 'f-depth-fill', type: 'fill', source: 'f-depths', paint: {'fill-color': DEPTH_COLOR, 'fill-opacity': 0.4}}, before);
    map.addLayer({id: 'f-depth-line', type: 'line', source: 'f-depths', paint: {'line-color': '#245b8f', 'line-opacity': 0.22, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 16, 0.6]}}, before);
    map.addLayer({
      id: 'f-depth-extrusion',
      type: 'fill-extrusion',
      source: 'f-depths',
      paint: {
        'fill-extrusion-color': DEPTH_COLOR,
        'fill-extrusion-height': ['*', HEIGHT_INPUT, this.verticalScale],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.38
      }
    }, before);
    map.addLayer({id: 'f-road-casing', type: 'line', source: 'f-roads', paint: {'line-color': '#ffffff', 'line-opacity': 0.92, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 6]}}, before);
    map.addLayer({
      id: 'f-road-lines',
      type: 'line',
      source: 'f-roads',
      paint: {
        'line-color': ROAD_COLOR,
        'line-opacity': 0.96,
        'line-width': ['case', ['==', ['get', 'impact'], 'excluded'], 4.2, ['==', ['get', 'impact'], 'bridge-review'], 3.9, 2.6],
        'line-dasharray': ['case', ['==', ['get', 'impact'], 'bridge-review'], ['literal', [2, 1.6]], ['literal', [1, 0]]]
      },
      layout: {'line-cap': 'round', 'line-join': 'round'}
    }, before);
    map.addLayer({id: 'f-route-before', type: 'line', source: 'f-route', filter: ['all', ['==', ['get', 'phase'], 'before'], ['==', ['get', 'kind'], 'main']], paint: {'line-color': '#87939c', 'line-width': 4, 'line-opacity': 0.78, 'line-dasharray': [1.2, 1.2]}, layout: {'line-cap': 'round', 'line-join': 'round'}}, before);
    map.addLayer({id: 'f-route-after-casing', type: 'line', source: 'f-route', filter: ['all', ['==', ['get', 'phase'], 'after'], ['==', ['get', 'kind'], 'main']], paint: {'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9}, layout: {'line-cap': 'round', 'line-join': 'round'}}, before);
    map.addLayer({id: 'f-route-after', type: 'line', source: 'f-route', filter: ['all', ['==', ['get', 'phase'], 'after'], ['==', ['get', 'kind'], 'main']], paint: {'line-color': '#087f80', 'line-width': 5, 'line-opacity': 1}, layout: {'line-cap': 'round', 'line-join': 'round'}}, before);
    map.addLayer({id: 'f-route-connectors', type: 'line', source: 'f-route', filter: ['==', ['get', 'kind'], 'connector'], paint: {'line-color': '#526574', 'line-width': 2, 'line-opacity': 0.72, 'line-dasharray': [1, 1.4]}, layout: {'line-cap': 'round', 'line-join': 'round'}}, before);
    this.applyVisibility();
  }

  attachMapEvents() {
    this.map.on('click', 'f-depth-fill', event => {
      const feature = event.features?.[0];
      if (feature) this.onDepth(feature);
    });
    this.map.on('click', 'f-depth-extrusion', event => {
      const feature = event.features?.[0];
      if (feature) this.onDepth(feature);
    });
    this.map.on('click', 'f-road-lines', event => {
      const feature = event.features?.[0];
      if (!feature) return;
      this.onRoad(this.roadOriginals.get(featureId(feature)) ?? feature);
    });
    for (const id of ['f-depth-fill', 'f-depth-extrusion', 'f-road-lines']) {
      this.map.on('mouseenter', id, () => { this.map.getCanvas().style.cursor = 'pointer'; });
      this.map.on('mouseleave', id, () => { this.map.getCanvas().style.cursor = ''; });
    }
  }

  addPlaceMarkers() {
    this.clearMarkers();
    this.places.forEach((place, index) => {
      const point = placePoint(place);
      if (!point || !this.map) return;
      const button = el('button', 'f-place-marker');
      button.type = 'button';
      const health = /health|clinic/.test(place.category ?? '') || /진료|보건/.test(place.name ?? '');
      if (health) button.className += ' health';
      const icon = el('span', 'f-place-icon');
      icon.innerHTML = health ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10"/></svg>';
      const label = el('span', 'f-place-pill');
      label.textContent = place.name ?? `시설 ${index + 1}`;
      const note = el('small'); note.textContent = '공개 주소 · 개방 미확인'; label.append(note);
      button.append(icon, label);
      button.title = place.name ?? `시설 ${index + 1}`;
      button.setAttribute('aria-label', `${button.title} 위치 보기`);
      button.addEventListener('click', () => this.onPlace(place.id ?? index, place));
      const marker = new window.maplibregl.Marker({element: button, anchor: 'center', opacityWhenCovered: 1}).setLngLat(point).addTo(this.map);
      this.markers.push(marker);
    });
  }

  clearMarkers() {
    this.markers.forEach(marker => marker.remove());
    this.markers = [];
  }

  async loadBuildings() {
    if (this.loadingBuildings || this.buildings || this.fallback || !this.map) return;
    this.loadingBuildings = true;
    this.onBuildings({status: 'loading', count: 0, total: 0, message: '운산면 건물 도형을 불러오는 중입니다.'});
    try {
      const data = await loadOfficialBuildings({onProgress: (count, total) => this.onBuildings({status: 'loading', count, total, message: '건물 도형을 불러오는 중입니다.'})});
      if (this.fallback || !this.map) return;
      const {count} = buildingSummary(data);
      this.buildings = data;
      this.map.addSource('f-buildings', {
        type: 'geojson',
        data,
        tolerance: 0,
        maxzoom: 18,
        attribution: `건물 © 행정안전부 · <a href="${BUILDING_SOURCE_URL}" target="_blank" rel="noopener">Esri Korea</a> · 2026.07 기준`
      });
      this.map.addLayer({id: 'f-buildings-fill', type: 'fill', source: 'f-buildings', paint: {'fill-color': '#8297a6', 'fill-opacity': 0.72}}, 'f-depth-fill');
      this.map.addLayer({id: 'f-buildings-line', type: 'line', source: 'f-buildings', paint: {'line-color': '#4d6576', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 16, 1]}}, 'f-depth-fill');
      this.map.addLayer({
        id: 'f-buildings-extrusion',
        type: 'fill-extrusion',
        source: 'f-buildings',
        filter: ['>', ['to-number', ['get', 'gro_flo_co'], 0], 0],
        paint: {
          'fill-extrusion-color': '#8da4b2',
          'fill-extrusion-height': ['*', ['to-number', ['get', 'gro_flo_co'], 0], 3],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.55
        }
      }, 'f-depth-fill');
      this.applyVisibility();
      this.onBuildings({status: 'ready', count, total: count, message: '공개 건물 도형을 표시합니다.'});
    } catch (error) {
      this.onBuildings({status: 'error', count: 0, total: 0, message: '건물 도형을 불러오지 못했습니다.'});
    } finally {
      this.loadingBuildings = false;
    }
  }

  retryBuildings() {
    this.buildings = null;
    if (this.map?.getLayer?.('f-buildings-extrusion')) this.map.removeLayer('f-buildings-extrusion');
    if (this.map?.getLayer?.('f-buildings-line')) this.map.removeLayer('f-buildings-line');
    if (this.map?.getLayer?.('f-buildings-fill')) this.map.removeLayer('f-buildings-fill');
    if (this.map?.getSource?.('f-buildings')) this.map.removeSource('f-buildings');
    return this.loadBuildings();
  }

  update({depths, exposure, route, verticalScale = 1, showFlood = true, showBuildings = true, building3d = true, showRoads = true, showLabels = true} = {}) {
    this.verticalScale = Number.isFinite(Number(verticalScale)) && Number(verticalScale) > 0 ? Number(verticalScale) : 1;
    this.showFlood = showFlood !== false;
    this.showBuildings = showBuildings !== false;
    this.building3d = building3d !== false;
    this.showRoads = showRoads !== false;
    this.showLabels = showLabels !== false;
    const safeDepths = safeCollection(depths, validPolygon, normalizeDepthFeature);
    const sourceRoads = isFeatureCollection(exposure) && exposure.features.length ? exposure : this.roads;
    const safeRoads = safeCollection(sourceRoads, validLine, (feature, index) => {
      const cloned = cloneFeature(feature, index);
      cloned.properties.impact = ['outside', 'below', 'excluded', 'depth-review', 'bridge-review'].includes(cloned.properties.impact) ? cloned.properties.impact : 'outside';
      if (typeof cloned.properties.depth_m === 'number' && Number.isFinite(cloned.properties.depth_m)) cloned.properties.depth_m = Number(cloned.properties.depth_m);
      if (Number.isFinite(Number(cloned.properties.display_height_m))) cloned.properties.display_height_m = Number(cloned.properties.display_height_m);
      return cloned;
    });
    this.roadOriginals.clear();
    for (const feature of safeRoads.features) this.roadOriginals.set(featureId(feature), feature);
    this.current = {depths: safeDepths, exposure: safeRoads, route};
    if (this.fallback) {
      this.renderFallback();
      return;
    }
    if (!this.ready) return;
    this.map.getSource('f-depths')?.setData(safeDepths);
    this.map.getSource('f-roads')?.setData(safeRoads);
    this.map.getSource('f-route')?.setData(COLLECTION(routeFeatures(route)));
    if (this.map.getLayer('f-depth-extrusion')) this.map.setPaintProperty('f-depth-extrusion', 'fill-extrusion-height', ['*', HEIGHT_INPUT, this.verticalScale]);
    this.applyVisibility();
    this.updateAnnotations();
  }

  applyVisibility() {
    if (!this.map) return;
    for (const id of ['f-road-casing', 'f-road-lines', 'f-route-before', 'f-route-after-casing', 'f-route-after', 'f-route-connectors']) setLayerVisibility(this.map, id, this.showRoads);
    const flood2d = this.showFlood;
    const flood3d = this.showFlood && this.view === '3d';
    setLayerVisibility(this.map, 'f-depth-fill', flood2d);
    setLayerVisibility(this.map, 'f-depth-line', flood2d);
    setLayerVisibility(this.map, 'f-depth-extrusion', flood3d);
    setLayerVisibility(this.map, 'f-buildings-fill', this.showBuildings);
    setLayerVisibility(this.map, 'f-buildings-line', this.showBuildings);
    setLayerVisibility(this.map, 'f-buildings-extrusion', this.showBuildings && this.building3d && this.view === '3d');
  }

  setView(view) {
    if (!['2d', '3d'].includes(view)) return;
    this.view = view;
    if (this.fallback) {
      this.onStatus({ready: true, mode: 'diagram', message: '도식 모드입니다.'});
      return;
    }
    if (!this.map) return;
    const duration = this.duration();
    this.map.easeTo({pitch: view === '3d' ? 58 : 0, bearing: view === '3d' ? -18 : 0, duration});
    this.applyVisibility();
    this.onStatus({ready: this.ready, mode: view, message: view === '3d' ? '수심을 수직 배율로 입체 표시합니다.' : '수심 범위를 평면으로 표시합니다.'});
  }

  focus(point, zoom = 16) {
    if (!finitePoint(point)) return;
    if (this.fallback) return;
    this.map?.easeTo({center: point, zoom, duration: this.duration()});
  }

  fit() {
    const route = routeFeatures(this.current.route).filter(feature => feature.properties.kind === 'main');
    const features = [...this.current.depths.features, ...route];
    const bounds = boundsFor(features);
    if (this.fallback) return;
    this.map?.fitBounds(bounds, {padding: this.fitPadding(), bearing:this.view==='3d'?-18:0, maxZoom:17.3, duration:this.duration()});
  }

  focusDepths() {
    const features = this.current.depths.features.length ? this.current.depths.features : routeFeatures(this.current.route).filter(feature => feature.properties.kind === 'main');
    if (!features.length) return this.fit();
    if (this.fallback) return;
    this.map?.fitBounds(boundsFor(features), {padding: this.fitPadding(), bearing:this.view==='3d'?-18:0, maxZoom:17.3, duration:this.duration()});
  }

  fitPadding() {
    if (window.innerWidth <= 600) return {top: 120, bottom: 205, left: 16, right: 25};
    return {top: 80, bottom: 105, left: 60, right: 70};
  }

  emitCamera() {
    if (!this.map?.getCenter) return;
    const center = this.map.getCenter();
    this.onCamera({lon:center.lng, lat:center.lat, bearing:this.map.getBearing(), pitch:this.map.getPitch(), zoom:this.map.getZoom()});
  }

  setLocked(locked) {
    this.locked = Boolean(locked);
    for (const key of ['dragPan','scrollZoom','boxZoom','dragRotate','keyboard','doubleClickZoom','touchZoomRotate','touchPitch']) {
      this.map?.[key]?.[this.locked ? 'disable' : 'enable']?.();
    }
  }

  updateAnnotations() {
    this.annotations.forEach(item => item.marker.remove());
    this.annotations = [];
    if (!this.map || !window.maplibregl?.Marker || !this.showLabels) return;
    const add = (feature, type) => {
      let point;
      if (type === 'depth') {
        const ring = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0];
        // Anchor at an actual polygon vertex; centroids can fall outside concave areas.
        point = ring[Math.floor((ring.length - 1) / 2)];
      } else {
        const line = feature.geometry.coordinates; point = line[Math.floor(line.length / 2)];
      }
      const props = feature.properties, button = el('button', `f-annotation f-${type}-marker ${props.impact ?? ''}`);
      button.type = 'button';
      if (type === 'depth') {
        const icon=el('span','f-water-icon'); icon.textContent='≋'; icon.setAttribute('aria-hidden','true');
        const value=el('strong'); value.textContent=props.depth_label || `${props.depth_m.toFixed(2)} m`;
        const kind=el('small'); kind.textContent=this.depthLabelKind || '수심';
        button.append(icon,value,kind); button.setAttribute('aria-label', `${props.name || '수심 구역'} · ${value.textContent} · ${kind.textContent}`);
        button.addEventListener('click', () => this.onDepth(feature));
      } else {
        const icon=el('b'); icon.textContent='△'; icon.setAttribute('aria-hidden','true');
        const value=el('span'); value.textContent=props.impact==='excluded' ? '도로 제외 가정' : props.impact==='bridge-review' ? '교량 확인' : '수심 구간 확인';
        button.append(icon,value);button.setAttribute('aria-label',`${props.name || '도로'} · ${value.textContent}`);
        button.addEventListener('click', () => this.onRoad(feature));
      }
      const marker=new window.maplibregl.Marker({element:button, anchor:'center', opacityWhenCovered:1}).setLngLat(point).addTo(this.map);
      this.annotations.push({marker,button,point,type});
    };
    // Every area remains rendered; labels are sampled and collision filtered for legibility.
    if (this.showFlood) {
      const ordered=[...this.current.depths.features].sort((a,b)=>b.properties.depth_m-a.properties.depth_m);
      const step=Math.max(1,Math.ceil(ordered.length/45));
      ordered.filter((_,i)=>i%step===0).forEach(f=>add(f,'depth'));
    }
    if (this.showRoads) this.current.exposure.features.filter(f=>['excluded','depth-review','bridge-review'].includes(f.properties.impact)).slice(0,40).forEach(f=>add(f,'road'));
    this.layoutAnnotations();
  }

  layoutAnnotations() {
    if (!this.map?.project || !this.container) return;
    const width=this.container.clientWidth, height=this.container.clientHeight, mobile=width<=600;
    const overlayRects = [...(document.querySelectorAll?.('.f-legend,.f-scenario-dock,.f-layer-switch,.f-map-heading,.f-map-context,.f-display-note,.f-building-status,.f-selection:not([hidden]),.f-map-options:not([hidden])') ?? [])].map(el=>el.getBoundingClientRect());
    const containerRect = this.container.getBoundingClientRect?.() ?? {left:0,top:0};
    this.markers.forEach(marker=>{
      const button=marker.getElement?.(), point=marker.getLngLat?.();if(!button||!point)return;
      const pos=this.map.project(point), w=mobile?115:170;
      button.hidden=pos.x<w/2 || pos.x>width-w/2 || pos.y<45 || pos.y>height-90
        || overlayRects.some(r=>pos.x+w/2>r.left-containerRect.left && pos.x-w/2<r.right-containerRect.left && pos.y+40>r.top-containerRect.top && pos.y-35<r.bottom-containerRect.top);
    });
    const occupied=this.places.map(place=>placePoint(place)).filter(Boolean).map(point=>{const p=this.map.project(point);return {x:p.x,y:p.y,w:mobile?115:170,h:70};});
    for (const item of this.annotations) {
      const p=this.map.project(item.point), w=item.type==='depth'?(mobile?100:140):130, h=45;
      const visible=p.x>w/2+12 && p.x<width-w/2-55 && p.y>(mobile?145:180) && p.y<height-(mobile?215:165)
        && !overlayRects.some(r=>p.x+w/2+8>r.left-containerRect.left && p.x-w/2-8<r.right-containerRect.left && p.y+h/2+8>r.top-containerRect.top && p.y-h/2-8<r.bottom-containerRect.top)
        && !occupied.some(r=>Math.abs(r.x-p.x)<(r.w+w)/2 && Math.abs(r.y-p.y)<(r.h+h)/2);
      item.button.hidden=!visible;
      if(visible) occupied.push({x:p.x,y:p.y,w,h});
    }
  }

  zoom(delta) {
    if (!Number.isFinite(delta) || this.fallback) return;
    this.map?.zoomTo(this.map.getZoom() + delta, {duration: this.duration()});
  }

  north() {
    if (this.fallback) return;
    this.map?.easeTo({bearing: 0, duration: this.duration()});
  }

  duration() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 550;
  }

  showFallback(message) {
    clearTimeout(this.loadTimer);
    this.fallback = true;
    this.ready = false;
    this.annotations.forEach(item => item.marker.remove());
    this.annotations = [];
    this.map?.remove?.();
    this.map = null;
    if (this.container) this.container.hidden = true;
    if (this.fallbackContainer) this.fallbackContainer.hidden = false;
    this.onStatus({ready: true, mode: 'diagram', message});
    this.renderFallback();
  }

  renderFallback() {
    if (!this.fallbackContainer) return;
    this.fallbackContainer.replaceChildren();
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'fallback-map');
    svg.setAttribute('viewBox', '0 0 960 660');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `수심 자료 도식 · 수직 표시 배율 ${this.verticalScale}배`);
    const bounds = boundsFor([...this.roads.features, ...this.current.depths.features]);
    const project = ([lon, lat]) => {
      const width = Math.max(0.0001, bounds[1][0] - bounds[0][0]);
      const height = Math.max(0.0001, bounds[1][1] - bounds[0][1]);
      return [50 + (lon - bounds[0][0]) / width * 860, 610 - (lat - bounds[0][1]) / height * 560];
    };
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', '960');
    bg.setAttribute('height', '660');
    bg.setAttribute('fill', '#f8fafb');
    svg.append(bg);
    if (this.showFlood) {
      for (const feature of this.current.depths.features) this.appendPolygon(svg, feature, project);
    }
    if (this.showRoads) {
      for (const feature of this.current.exposure.features.length ? this.current.exposure.features : this.roads.features) this.appendRoad(svg, feature, project);
      for (const feature of routeFeatures(this.current.route)) this.appendRoute(svg, feature, project);
    }
    this.places.forEach((place, index) => this.appendPlace(svg, place, index, project));
    const note = document.createElementNS(SVG_NS, 'text');
    note.setAttribute('x', '40');
    note.setAttribute('y', '635');
    note.textContent = `수심 자료 범위 · 수직 표시 배율 ${this.verticalScale}배 · 실제 안전 경로 아님`;
    svg.append(note);
    this.fallbackContainer.append(svg);
  }

  appendPolygon(svg, feature, project) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const label = feature.properties.depth_label ?? `수심 ${Number(feature.properties.depth_m).toFixed(2)}m`;
    for (const polygon of polygons) {
      const path = document.createElementNS(SVG_NS, 'path');
      const d = polygon.map(ring => ring.map((point, index) => `${index ? 'L' : 'M'}${project(point).map(n => n.toFixed(1)).join(',')}`).join(' ') + ' Z').join(' ');
      path.setAttribute('d', d);
      path.setAttribute('fill', feature.properties.depth_color ?? depthColor(feature.properties.depth_m));
      path.setAttribute('fill-opacity', '0.34');
      path.setAttribute('stroke', '#245b8f');
      path.setAttribute('stroke-width', '1.4');
      path.setAttribute('aria-label', String(label));
      path.addEventListener('click', () => this.onDepth(feature));
      svg.append(path);
    }
  }

  appendRoad(svg, feature, project) {
    if (!validLine(feature)) return;
    const path = document.createElementNS(SVG_NS, 'polyline');
    path.setAttribute('points', feature.geometry.coordinates.map(point => project(point).map(n => n.toFixed(1)).join(',')).join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', {excluded: '#d14d37', 'depth-review': '#e08a22', 'bridge-review': '#c59020', below: '#77a9b6'}[feature.properties.impact] ?? '#9aa8b2');
    path.setAttribute('stroke-width', feature.properties.impact === 'excluded' ? '4' : '2.4');
    path.setAttribute('stroke-linecap', 'round');
    if (feature.properties.impact === 'bridge-review') path.setAttribute('stroke-dasharray', '6 5');
    path.setAttribute('role', 'button');
    path.setAttribute('tabindex', '0');
    path.setAttribute('aria-label', `${feature.properties.name ?? '공개 도로'} · ${STATUS_LABELS[feature.properties.impact] ?? '영향 미분류'}`);
    const select = () => this.onRoad(this.roadOriginals.get(featureId(feature)) ?? feature);
    path.addEventListener('click', select);
    path.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    svg.append(path);
  }

  appendRoute(svg, feature, project) {
    if (!validLine(feature)) return;
    const path = document.createElementNS(SVG_NS, 'polyline');
    path.setAttribute('points', feature.geometry.coordinates.map(point => project(point).map(n => n.toFixed(1)).join(',')).join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', feature.properties.phase === 'after' ? '#087f80' : '#87939c');
    path.setAttribute('stroke-width', feature.properties.phase === 'after' ? '5' : '3.5');
    path.setAttribute('stroke-linecap', 'round');
    if (feature.properties.kind === 'connector' || feature.properties.phase === 'before') path.setAttribute('stroke-dasharray', '7 6');
    svg.append(path);
  }

  appendPlace(svg, place, index, project) {
    const point = placePoint(place);
    if (!point) return;
    const [x, y] = project(point);
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'f-place-marker');
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-label', `${place.name ?? `시설 ${index + 1}`} 위치`);
    group.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('r', '13');
    circle.setAttribute('fill', '#ffffff');
    circle.setAttribute('stroke', '#087f80');
    circle.setAttribute('stroke-width', '3');
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('y', '4');
    text.textContent = String(index + 1);
    group.append(circle, text);
    const select = () => this.onPlace(place.id ?? index, place);
    group.addEventListener('click', select);
    group.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    svg.append(group);
  }
}
