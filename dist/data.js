// Only the background location is geographic context. All operational features below are fictional.
export const CENTER = [126.6203, 36.7691];
export const NODES = {
  a:[126.628,36.764], b:[126.63,36.752], c:[126.622,36.786], d:[126.605,36.783],
  j1:[126.616,36.759], j2:[126.613,36.769], j3:[126.613,36.781],
  s1:[126.602,36.769], s2:[126.631,36.792], s3:[126.637,36.747]
};
export const VILLAGES = [
  {id:'a',code:'A',name:'원평리 북측',subtitle:'시연 마을 A',note:'진입 교량과 우회 구간의 상태를 함께 확인하세요.'},
  {id:'b',code:'B',name:'원평리 남측',subtitle:'시연 마을 B',note:'남측 진입로 통제와 대체 시설의 개방 여부를 확인하세요.'},
  {id:'c',code:'C',name:'고풍리 동측',subtitle:'시연 마을 C',note:'연결 교량의 상태가 바뀌면 접근성을 다시 확인하세요.'},
  {id:'d',code:'D',name:'고풍리 서측',subtitle:'시연 마을 D',note:'기록된 경로는 현장 안전을 보장하지 않습니다.'}
];
export const SHELTERS = [
  {id:'s1',name:'대피시설 A',subtitle:'서측 거점 · 시연용',status:'open'},
  {id:'s2',name:'대피시설 B',subtitle:'동측 거점 · 시연용',status:'closed'},
  {id:'s3',name:'대피시설 C',subtitle:'남측 거점 · 시연용',status:'closed'}
];
const road=(id,name,from,to,points=[])=>({id,name,from,to,coordinates:[NODES[from],...points,NODES[to]]});
export const ROADS = [
  road('bridge-a','마을 A 진입 교량','a','j1',[[126.625,36.762],[126.621,36.762],[126.62,36.759]]),
  road('detour-a','마을 A 우회 구간','a','j2',[[126.627,36.767],[126.623,36.771],[126.619,36.772]]),
  road('road-b','마을 B 진입로','b','j1',[[126.626,36.753],[126.622,36.755],[126.621,36.758]]),
  road('main-south','남측 연결도로','j1','j2',[[126.615,36.764]]),
  road('main-north','북측 연결도로','j2','j3',[[126.611,36.773],[126.6115,36.777]]),
  road('bridge-c','마을 C 연결 교량','c','j3',[[126.618,36.7845],[126.617,36.782]]),
  road('road-d','마을 D 진입로','d','j3',[[126.608,36.7815]]),
  road('facility-a','서측 시설 진입로','j2','s1',[[126.608,36.7678],[126.604,36.768]]),
  road('facility-b','동측 시설 진입로','c','s2',[[126.625,36.787],[126.628,36.788]]),
  road('facility-c','남측 시설 진입로','b','s3',[[126.634,36.750]])
];
export const SCENARIOS = [
 {id:0,time:'06:00',title:'상황 확인',description:'모든 시연 도로의 연결을 살펴보세요.',roads:{},shelters:{s1:'open',s2:'closed',s3:'closed'}},
 {id:1,time:'06:30',title:'교량 통제',description:'교량·진입로 통제 이후 우선 확인할 마을이 달라집니다.',roads:{'bridge-a':'closed','detour-a':'unknown','road-b':'closed'},shelters:{s1:'open',s2:'closed',s3:'closed'}},
 {id:2,time:'07:00',title:'복수 구간 통제',description:'동측 교량 통제를 추가해 마을별 연결 변화를 확인하세요.',roads:{'bridge-a':'closed','detour-a':'unknown','road-b':'closed','bridge-c':'closed'},shelters:{s1:'open',s2:'closed',s3:'closed'}}
];
export const FLOOD_POLYGONS = [
 [[126.62,36.758],[126.622,36.756],[126.627,36.756],[126.632,36.761],[126.631,36.766],[126.627,36.768],[126.623,36.765],[126.62,36.758]],
 [[126.613,36.779],[126.618,36.779],[126.623,36.783],[126.626,36.787],[126.623,36.789],[126.618,36.785],[126.613,36.783],[126.613,36.779]]
];
export const SOURCES = [
 {title:'배경지도',status:'공개 공간자료',text:'OpenFreeMap / OpenStreetMap. 지도 표시는 실제 지리적 배경이며, 도로망 분석은 별도의 가상 데이터입니다.',url:'https://openfreemap.org/'},
 {title:'3D 지형',status:'공개 고도자료',text:'Mapterhorn 고도 타일. 지형 개관용으로, 교량 상판 높이나 침수 수심을 검증한 자료가 아닙니다.',url:'https://mapterhorn.com/'},
 {title:'마을·도로·대피시설',status:'시연용 가상 데이터',text:'시설 위치·이름·운영상태, 도로 선형·통제, 영향 범위를 시연 목적으로 구성했습니다. 공식 시설이나 현재 재난정보가 아닙니다.'},
 {title:'지역 선정 근거',status:'서산시 공개자료',text:'운산면의 지역특성·인구 및 마을 현황을 참고했습니다.',url:'https://www.seosan.go.kr/welfare/contents.do?key=2436'},
 {title:'디자인 참고',status:'Augma Bangkok Map',text:'넓은 3D 지도, 정보 레이어, 지역 상세와 출처 안내를 참고해 운산면 담당자 업무에 맞게 새로 구현했습니다.',url:'https://situational-bangkok-flood.web.app/3d/'}
];
