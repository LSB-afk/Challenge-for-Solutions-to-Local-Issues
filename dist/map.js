import {CENTER,NODES,VILLAGES,SHELTERS,ROADS,FLOOD_POLYGONS} from './data.js';
import {analyzeVillage,analyzeAll} from './engine.js';
import {buildingLayers,buildingSummary,nearestBuildingCenter,loadOfficialBuildings,BUILDING_SOURCE_URL} from './buildings.js';

const COLORS={connected:'#087f80',open:'#087f80',unknown:'#8c6500',blocked:'#bd452b',closed:'#bd452b'};
const collection=features=>({type:'FeatureCollection',features});
const line=(coordinates,properties={})=>({type:'Feature',properties,geometry:{type:'LineString',coordinates}});
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export class AccessMap {
  constructor({onSelect,onShelter}){this.onSelect=onSelect;this.onShelter=onShelter;this.markers=[];this.incidentMarkers=[];this.layers={flood:true,roads:true,shelters:true,buildings:true,reports:true};this.ready=false;this.fallback=false;this.selected='a';this.view='3d';}
  async init(state){
    this.state=state;
    try {
      if(!window.maplibregl&&document.readyState!=='complete')await new Promise(resolve=>window.addEventListener('load',resolve,{once:true}));
      if(!window.maplibregl)throw Error('지도 모듈');
      const response=await fetch('https://tiles.openfreemap.org/styles/liberty',{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error('배경지도');
      const style=await response.json();
      this.style=style;
      for(const layer of style.layers){
        if(layer.type==='fill-extrusion'||layer['source-layer']==='building')layer.layout={...layer.layout,visibility:'none'};
        const paint=layer.paint??{};
        if(layer.type==='background')paint['background-color']='#f8fafb';
        if(layer.type==='fill'){
          if(/water/.test(layer.id))paint['fill-color']='#b6dce7';
          else if(/building/.test(layer.id))paint['fill-color']='#a8b7bf';
          else if(/wood|forest|park|grass/.test(layer.id))paint['fill-color']='#e4ede4';
          else paint['fill-color']='#f1f3ed';
        }
        if(layer.type==='line'){
          if(/water/.test(layer.id))paint['line-color']='#89bece';
          else if(/boundary/.test(layer.id)){paint['line-color']='#8597a4';paint['line-opacity']=.28;}
          else if(/road|highway|motorway|path/.test(layer.id))paint['line-color']=/casing/.test(layer.id)?'#cbd3d5':'#ffffff';
        }
        if(layer.type==='symbol'){
          paint['text-color']='#465b69';paint['text-halo-color']='#ffffff';paint['text-halo-width']=1.4;
          if(/poi|transit|airport/.test(layer.id))layer.layout={...layer.layout,visibility:'none'};
        }
        layer.paint=paint;
      }
      const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.map=new maplibregl.Map({container:'map',style,center:CENTER,zoom:13.15,pitch:53,bearing:-17,minZoom:10,maxZoom:18,attributionControl:{compact:true},maxPitch:70,fadeDuration:reduced?0:180});
      this.map.addControl(new maplibregl.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-left');
      this.loadTimer=setTimeout(()=>{if(!this.ready)this.showFallback('배경지도 연결이 지연돼 시연 연결도로를 도식으로 표시합니다.');},18000);
      this.map.on('error',event=>{
        if(event.sourceId==='terrain-dem'){
          if(this.map.getTerrain())this.map.setTerrain(null);
          document.querySelector('#map-engine-status').textContent='3D 시점 · 고도자료 연결 지연';
        }
      });
      this.map.once('load',()=>{
        if(this.fallback)return;
        try {
          this.addLayers();this.addMarkers();this.ready=true;
          for(const [key,enabled] of Object.entries(this.layers))this.setLayer(key,enabled);
          this.update(this.state,this.selected);this.reset(0);this.loadBuildings();
          clearTimeout(this.loadTimer);
          document.querySelector('#map-engine-status').textContent='배경 OpenStreetMap · 고도 Mapterhorn';
          document.querySelector('#map').dataset.ready='true';
        }catch{this.showFallback('지도 구성에 실패했습니다. 시연 도로 도식으로 계속 확인할 수 있습니다.');}
      });
    }catch(error){this.showFallback('배경지도에 연결하지 못했습니다. 시연 도로 도식으로 계속 확인할 수 있습니다.');}
  }
  addLayers(){
    const map=this.map;
    map.addSource('terrain-dem',{type:'raster-dem',url:'https://tiles.mapterhorn.com/tilejson.json',tileSize:512,encoding:'terrarium',maxzoom:12});
    map.setTerrain({source:'terrain-dem',exaggeration:1.15});
    map.addSource('demo-flood',{type:'geojson',data:collection(FLOOD_POLYGONS.map(coordinates=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[coordinates]}})))});
    map.addLayer({id:'demo-flood-fill',type:'fill',source:'demo-flood',paint:{'fill-color':'#368ead','fill-opacity':.17}});
    map.addLayer({id:'demo-flood-line',type:'line',source:'demo-flood',paint:{'line-color':'#368ead','line-opacity':.65,'line-width':1,'line-dasharray':[3,3]}});
    map.addSource('demo-roads',{type:'geojson',data:collection([])});
    map.addLayer({id:'demo-road-shadow',type:'line',source:'demo-roads',paint:{'line-color':'#ffffff','line-width':9,'line-opacity':.8}});
    map.addLayer({id:'demo-road-lines',type:'line',source:'demo-roads',paint:{'line-color':['match',['get','status'],'closed',COLORS.closed,'unknown',COLORS.unknown,'#7e929d'],'line-width':['case',['==',['get','status'],'closed'],4.5,3],'line-opacity':.95},layout:{'line-cap':'round','line-join':'round'}});
    map.addLayer({id:'demo-road-unknown',type:'line',source:'demo-roads',filter:['==',['get','status'],'unknown'],paint:{'line-color':'#fff6dc','line-width':3,'line-dasharray':[2,2]}});
    map.addSource('selected-route',{type:'geojson',data:collection([])});
    map.addLayer({id:'selected-route-line',type:'line',source:'selected-route',paint:{'line-color':['get','color'],'line-width':5.5,'line-opacity':1},layout:{'line-cap':'round','line-join':'round'}});
    for(const [key,enabled] of Object.entries(this.layers))this.setLayer(key,enabled);
    if(this.view==='2d')this.setView('2d');
  }
  async loadBuildings(){
    if(this.loadingBuildings||this.buildings||this.fallback)return;
    this.loadingBuildings=true;
    document.querySelector('#building-retry').hidden=true;
    document.querySelector('#building-status').textContent='운산면 건물 목록 확인 중';
    try{
      const data=await loadOfficialBuildings({onProgress:(loaded,total)=>{
        document.querySelector('#building-status').textContent=`건물 ${loaded.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')}개 불러오는 중`;
      }});
      if(this.fallback)return;
      this.map.addSource('actual-buildings',{type:'geojson',data,tolerance:0,maxzoom:18,attribution:`건물 © 행정안전부 · <a href="${BUILDING_SOURCE_URL}" target="_blank" rel="noopener">Esri Korea</a> · 2026.07 기준`});
      for(const layer of buildingLayers())this.map.addLayer(layer,'demo-flood-fill');
      this.buildings=data;this.buildingStats=buildingSummary(data);
      this.setLayer('buildings',this.layers.buildings);
      document.querySelector('#building-focus').disabled=false;
      this.map.on('click','actual-buildings-fill',event=>this.showBuilding(event.features?.[0],event.lngLat));
      this.map.on('mouseenter','actual-buildings-fill',()=>{this.map.getCanvas().style.cursor='pointer';});
      this.map.on('mouseleave','actual-buildings-fill',()=>{this.map.getCanvas().style.cursor='';});
    }catch{
      if(this.fallback)return;
      for(const {id} of buildingLayers())if(this.map.getLayer?.(id))this.map.removeLayer(id);
      if(this.map.getSource?.('actual-buildings'))this.map.removeSource('actual-buildings');
      this.buildings=null;this.buildingStats=null;
      document.querySelector('#building-status').textContent='건물 자료를 불러오지 못했습니다';
      document.querySelector('#building-note').textContent='공개 서비스 연결 또는 전체 건물 검증에 실패했습니다. 다시 불러올 수 있습니다.';
      document.querySelector('#building-retry').hidden=false;
    }finally{this.loadingBuildings=false;}
  }
  showBuildingStatus(){
    if(!this.buildingStats)return;
    const {count}=this.buildingStats;
    document.querySelector('#building-status').textContent=`운산면 건물 ${count.toLocaleString('ko-KR')}개 · ${this.layers.buildings?'표시 중':'숨김'}`;
    document.querySelector('#building-note').textContent='2026.07 기준 원본 수록 도형 전체. 높이는 미제공으로 윤곽만 표시합니다. 신축·멸실 반영 시차가 있을 수 있습니다.';
  }
  focusBuildings(){
    if(!this.ready||!this.buildings||this.fallback)return;
    const center=nearestBuildingCenter(this.buildings,NODES[this.selected]);
    if(center)this.map.easeTo({center,zoom:16.5,padding:this.cameraPadding(),duration:this.duration()});
  }
  showBuilding(feature,position){
    if(!feature)return;
    const properties=feature.properties??{},content=document.createElement('div');content.className='building-popup';
    const title=document.createElement('strong');title.textContent=properties.building_name||'주소 기반 건물';content.append(title);
    const address=document.createElement('p');address.textContent=[properties.street_name,properties.house_number].filter(Boolean).join(' ')||'주소 정보 없음';content.append(address);
    const floors=document.createElement('p');floors.textContent=properties.gro_flo_co>0?`지상 ${properties.gro_flo_co}층${properties.und_flo_co>0?` · 지하 ${properties.und_flo_co}층`:''} · 높이 미제공`:'층수·높이 미제공';content.append(floors);
    const source=document.createElement('small');source.textContent='행정안전부 · Esri Korea / 2026.07 기준';content.append(source);
    this.buildingPopup?.remove();this.buildingPopup=new maplibregl.Popup({maxWidth:'260px',closeButton:true}).setLngLat(position).setDOMContent(content).addTo(this.map);
  }
  addMarkers(){
    for(const village of VILLAGES){
      const el=document.createElement('button');el.className='village-marker';el.setAttribute('aria-label',`${village.name} 시연 마을 선택`);el.innerHTML=`<span class="marker-core">${village.code}</span><span class="marker-name">${village.name} · 시연</span><span class="report-badge" hidden></span>`;
      el.addEventListener('click',()=>this.onSelect(village.id));
      const marker=new maplibregl.Marker({element:el,anchor:'center',opacityWhenCovered:1}).setLngLat(NODES[village.id]).addTo(this.map);
      this.markers.push({id:village.id,kind:'village',marker,el});
    }
    for(const shelter of SHELTERS){
      const el=document.createElement('button');el.className='shelter-marker';el.setAttribute('aria-label',`${shelter.name} 시연 시설 보기`);el.innerHTML=`<span class="marker-core">${icon('home')}</span><span class="marker-name">${shelter.name} · 시연</span>`;
      el.addEventListener('click',()=>this.onShelter(shelter.id));
      const marker=new maplibregl.Marker({element:el,anchor:'center',opacityWhenCovered:1}).setLngLat(NODES[shelter.id]).addTo(this.map);
      this.markers.push({id:shelter.id,kind:'shelter',marker,el});
    }
  }
  update(state,selected=this.selected){
    this.state=state;this.selected=selected;
    if(this.fallback){this.renderFallback();return;}
    if(!this.ready)return;
    this.map.getSource('demo-roads').setData(collection(ROADS.map(r=>line(r.coordinates,{id:r.id,status:state.roads[r.id]??'unknown'}))));
    const result=analyzeVillage(selected,state);
    const route=result.route?result.route.edges.map(id=>line(ROADS.find(r=>r.id===id).coordinates,{color:COLORS[result.status]})):[];
    this.map.getSource('selected-route').setData(collection(route));
    for(const item of this.markers){
      item.el.classList.remove('connected','unknown','blocked','open','closed','selected');
      if(item.kind==='village'){const status=analyzeVillage(item.id,state).status;item.el.classList.add(status);item.el.classList.toggle('selected',item.id===selected);item.el.setAttribute('aria-pressed',String(item.id===selected));
        const count=(state.logs??[]).filter(log=>log.village===item.id&&log.status==='미확인').length,badge=item.el.querySelector('.report-badge');
        badge.textContent=String(count);badge.hidden=!count||!this.layers.reports;
        item.el.setAttribute('aria-label',`${VILLAGES.find(v=>v.id===item.id).name} 시연 마을 선택${count?`, 미확인 신고 ${count}건`:''}`);
      }
      else {item.el.classList.add(state.shelters[item.id]);item.el.hidden=!this.layers.shelters;}
    }
    this.incidentMarkers.forEach(m=>m.remove());this.incidentMarkers=[];
    for(const road of ROADS.filter(r=>state.roads[r.id]==='closed')){
      const el=document.createElement('div');el.className='blocked-marker';el.setAttribute('role','img');el.setAttribute('aria-label',`${road.name} 통제 · 시연`);el.innerHTML=`${icon('close')}<span>통제 · 시연</span>`;
      const p=road.coordinates[Math.floor(road.coordinates.length/2)];
      const marker=new maplibregl.Marker({element:el,opacityWhenCovered:1}).setLngLat(p).addTo(this.map);el.hidden=!this.layers.roads;this.incidentMarkers.push(marker);
    }
    this.map.setPaintProperty('demo-flood-fill','fill-opacity',state.scenario===0?.07:state.scenario===1?.17:.27);
  }
  setView(view){this.view=view;if(!this.map||!this.ready)return;this.reset();}
  duration(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:650;}
  cameraPadding(){const box=document.querySelector('#map').getBoundingClientRect();return window.innerWidth<=760?{top:85,bottom:Math.min(225,box.height*.43),left:40,right:45}:{top:115,bottom:100,left:80,right:Math.min(360,box.width*.42)};}
  focus(id){if(!this.ready||this.fallback)return;this.map.easeTo({center:NODES[id],zoom:13.3,duration:this.duration(),padding:this.cameraPadding()});}
  zoom(delta){if(this.ready&&!this.fallback)this.map.zoomTo(this.map.getZoom()+delta,{duration:this.duration()});}
  north(){if(this.ready&&!this.fallback)this.map.easeTo({bearing:0,duration:this.duration()});}
  reset(duration=this.duration()){if(this.ready&&!this.fallback&&this.map.getContainer().clientWidth)this.map.fitBounds([[126.590,36.744],[126.640,36.795]],{pitch:this.view==='3d'?53:0,bearing:this.view==='3d'?-17:0,padding:this.cameraPadding(),duration,maxZoom:13});}
  resize(){this.map?.resize();const box=this.map?.getContainer();const size=box?`${box.clientWidth}:${box.clientHeight}`:'';if(size!==this.lastSize&&box?.clientWidth){this.lastSize=size;this.reset(0);}}
  setLayer(key,enabled){
    this.layers[key]=enabled;
    if(this.fallback){this.renderFallback();return;}
    if(!this.ready)return;
    const ids={flood:['demo-flood-fill','demo-flood-line'],roads:['demo-road-shadow','demo-road-lines','demo-road-unknown','selected-route-line'],buildings:['actual-buildings-fill','actual-buildings-line'],shelters:[]}[key]??[];
    for(const id of ids)if(id&&this.map.getLayer(id))this.map.setLayoutProperty(id,'visibility',enabled?'visible':'none');
    if(key==='buildings')this.showBuildingStatus();
    if(key==='shelters')this.markers.filter(x=>x.kind==='shelter').forEach(x=>x.el.hidden=!enabled);
    if(key==='roads')this.incidentMarkers.forEach(x=>x.getElement().hidden=!enabled);
    if(key==='reports')this.markers.filter(x=>x.kind==='village').forEach(x=>{const badge=x.el.querySelector('.report-badge');badge.hidden=!enabled||Number(badge.textContent)===0;});
  }
  showFallback(message){
    clearTimeout(this.loadTimer);this.fallback=true;this.ready=false;this.map?.remove();this.map=null;
    document.querySelector('#map').hidden=true;document.querySelector('#map-fallback').hidden=false;
    document.querySelector('#map-engine-status').textContent='연결도로 도식 · 배경지도 연결 불가';
    document.querySelector('#map-error').hidden=false;document.querySelector('#map-error').textContent=message;
    ['view-3d','view-2d','map-zoom-in','map-zoom-out','map-north','map-reset','building-focus'].forEach(id=>document.getElementById(id).disabled=true);
    document.querySelector('#building-status').textContent='건물 지도 표시 불가 · 도로 연결 도식';
    this.renderFallback();
  }
  renderFallback(){
    const project=([x,y])=>[80+(x-126.59)/.057*750,100+(36.805-y)/.065*510];
    const results=analyzeAll(this.state),route=analyzeVillage(this.selected,this.state);
    const roads=this.layers.roads?ROADS.map(r=>{const p=r.coordinates.map(project).map(x=>x.join(',')).join(' '),status=this.state.roads[r.id];return `<polyline points="${p}" fill="none" stroke="${route.route?.edges.includes(r.id)?COLORS[route.status]:COLORS[status]??'#7e929d'}" stroke-width="${route.route?.edges.includes(r.id)?5:3}" ${status==='unknown'?'stroke-dasharray="6 6"':''}/>`;}).join(''):'';
    const villages=VILLAGES.map(v=>{const [x,y]=project(NODES[v.id]),status=results.find(r=>r.id===v.id).status,pending=this.layers.reports?(this.state.logs??[]).filter(log=>log.village===v.id&&log.status==='미확인').length:0;return `<g class="diagram-village" data-village="${v.id}" role="button" tabindex="0" aria-label="${v.name} 시연 마을 선택" transform="translate(${x},${y})"><circle r="18" fill="#ffffff" stroke="${COLORS[status]}" stroke-width="${v.id===this.selected?4:2}"/><text text-anchor="middle" y="4">${v.code}</text><text text-anchor="middle" y="38">${v.name} · 시연</text>${pending?`<text class="diagram-report" text-anchor="middle" y="55">미확인 신고 ${pending}건</text>`:''}</g>`;}).join('');
    const shelters=this.layers.shelters?SHELTERS.map(s=>{const [x,y]=project(NODES[s.id]);return `<g transform="translate(${x},${y})"><rect x="-12" y="-12" width="24" height="24" rx="4" fill="#e0f1f0" stroke="#87bab7"/><text text-anchor="middle" y="4">⌂</text><text text-anchor="middle" y="30">${s.name} · 시연</text></g>`;}).join(''):'';
    document.querySelector('#map-fallback').innerHTML=`<svg class="fallback-map" viewBox="0 0 960 660" role="img" aria-label="가상 도로망 연결 도식"><defs><pattern id="grid" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M45 0H0V45" fill="none" stroke="#c8d5de" stroke-width=".5"/></pattern></defs><rect width="960" height="660" fill="url(#grid)"/>${roads}${shelters}${villages}<text x="40" y="630">시연 도식 · 실제 도로 및 시설 위치가 아닙니다</text></svg>`;
    document.querySelectorAll('.diagram-village').forEach(el=>{el.addEventListener('click',()=>this.onSelect(el.dataset.village));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.onSelect(el.dataset.village);}});});
  }
}
