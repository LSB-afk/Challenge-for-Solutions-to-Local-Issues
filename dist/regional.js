const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function sourceLink(source, label = '공개 출처 확인 ↗') {
  if (!source?.url?.startsWith('https://')) return '';
  return `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`;
}
async function load() {
  try {
    const responses = await Promise.all([fetch('./data/regional-evidence.json'), fetch('./data/unsan-osm-roads.geojson')]);
    if (responses.some(response => !response.ok)) throw new Error('자료 응답 실패');
    const [data, roads] = await Promise.all(responses.map(response => response.json()));
    if (!Array.isArray(data.places) || !Array.isArray(roads.features) || data.roads.featureCount !== roads.features.length) throw new Error('자료 수 불일치');
    const source = id => data.sources.find(item => item.id === id);
    const located = data.places.filter(place => place.coordinate);
    const bbox = data.targetArea.bbox;
    const width = 740, height = 550, padding = 35;
    const aspect = Math.cos((bbox[1] + bbox[3]) / 2 * Math.PI / 180);
    const scale = Math.min((width - 2 * padding) / ((bbox[2] - bbox[0]) * aspect), (height - 2 * padding) / (bbox[3] - bbox[1]));
    const project = ([lon, lat]) => [(width - (bbox[2] - bbox[0]) * aspect * scale) / 2 + (lon - bbox[0]) * aspect * scale, padding + (bbox[3] - lat) * scale];
    const paths = roads.features.map((feature, index) => `<path id="road-${index}" class="road-line ${feature.properties.bridge && feature.properties.bridge !== 'no' ? 'bridge' : ''}" d="${feature.geometry.coordinates.map((point, i) => `${i ? 'L' : 'M'}${project(point).map(value => value.toFixed(2)).join(',')}`).join(' ')}"/>`).join('');
    const markers = located.map(place => {const index = data.places.indexOf(place); const [x,y] = project([place.coordinate.lon,place.coordinate.lat]); return `<g><circle cx="${x}" cy="${y}" r="13" fill="#087f80" stroke="white" stroke-width="2"/><text x="${x}" y="${y+4}" fill="white" font-size="12" text-anchor="middle">${index+1}</text></g>`;}).join('');
    $('#road-map').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="원평리 고풍리 주변 공개 도로 ${roads.features.length}개와 주소 대조 지점 ${located.length}곳. 현재 통행 상태는 미확인."><rect width="${width}" height="${height}" fill="#eef3ee"/>${paths}${markers}<text x="20" y="25" font-size="12" fill="#526574">N ↑ / 공개 지도 형상 · 현재 통행 상태 미확인</text><text x="20" y="${height-15}" font-size="11" fill="#526574">© OpenStreetMap contributors / ODbL · 번호는 아래 시설 목록과 대응</text></svg>`;
    $('#road-select').innerHTML = roads.features.map((feature,index) => `<option value="${index}">${escape(feature.properties.name || '이름 없는 도로')} · ${escape(feature.properties.highway)} · OSM ${feature.properties.osmId}</option>`).join('');
    function selectRoad(){
      const index = Number($('#road-select').value), road = roads.features[index];
      if (!road) return;
      document.querySelectorAll('.road-line.selected').forEach(path => path.classList.remove('selected'));
      $(`#road-${index}`).classList.add('selected');
      $('#road-detail').innerHTML = `<strong>${escape(road.properties.name || '이름 없는 도로')}</strong> · ${escape(road.properties.highway)}<br>통행 상태: 미확인 · 교량 태그: ${escape(road.properties.bridge || '없음')}<br><a href="https://www.openstreetmap.org/way/${Number(road.properties.osmId)}" target="_blank" rel="noopener noreferrer">원본 도로 객체 보기 ↗</a>`;
    }
    $('#road-select').addEventListener('change', selectRoad); selectRoad();
    $('#coverage').innerHTML = [[roads.features.length,'공개 도로 객체'],[data.roads.bridgeTaggedWayCount,'교량 태그 도로 객체'],[located.length+'/'+data.places.length,'주소·건물 좌표 대조'],['미확인','풍수해 지정·개방']].map(([number,label]) => `<div><strong>${escape(number)}</strong><span>${label}</span></div>`).join('');
    $('#unresolved').innerHTML = data.unresolved.map(item => `<li>${escape(item)}</li>`).join('');
    $('#places').innerHTML = data.places.map((place,index) => `<article class="place-card"><span class="number">${index+1 < 10 ? '0' : ''}${index+1} / ${place.coordinate?'주소·건물 객체 대조':'공식 주소 확인'}</span><h3>${escape(place.name)}</h3><p>${escape(place.officialAddress)}</p><small>${place.coordinate?`${place.coordinate.lat.toFixed(6)}° N · ${place.coordinate.lon.toFixed(6)}° E<br>건물 객체 ${escape(place.coordinateSource.objectid)} · 건물 중심점`:'좌표 미확보 · 지도에 임의 배치하지 않음'}</small><span class="badge">풍수해 대피시설 지정 미확인</span><small>${escape(place.notes.join(' '))}</small><p>${sourceLink(source(place.officialSourceId),'공식 시설 목록 ↗')}</p></article>`).join('');
    $('#events').innerHTML = data.eventEvidence.map(item => `<article class="event-card"><p>${escape(item.claim)}</p><small>${escape(item.limitation)}</small>${sourceLink(source(item.sourceId))}</article>`).join('');
    $('#data-downloads').innerHTML = '<a href="./data/regional-evidence.json" download>출처·검증 목록 JSON ↓</a><a href="./data/unsan-osm-roads.geojson" download>공개 도로 GeoJSON ↓</a><a href="./regional-validation.md" download>자료 검증 기록 ↓</a>';
    $('#load-status').textContent = `자료 추출 ${data.generatedAt.slice(0,10)} · 도로 형상 기준 ${data.roads.osmBaseTimestamp.slice(0,10)} · 실제 현장 확인 전`;
    $('#evidence').hidden = false;
  } catch {
    $('#load-status').textContent = '지역 자료를 불러오지 못했습니다. 연결 상태를 확인한 뒤 새로고침해 주세요. 이 화면에서 통행 상태를 판단할 수 없습니다.';
  }
}
load();
