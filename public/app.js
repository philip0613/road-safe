// ==========================================
// 1. 앱 상태 관리
// ==========================================
let map = null;
let currentFilter = 'all';
let userPoints = 3450;
let userCoords = { lat: 37.5665, lon: 126.9780 };

let currentBase64Image = null;
let currentMimeType = null;
let routePolyline = null;

// 스크린샷과 동일한 목업 및 사용자 제보 마커 리스트
let complaints = [
  { id: 1, type: 'danger', lat: 37.5670, lon: 126.9772, title: '대형 포트홀 위험', isMine: false },
  { id: 2, type: 'warning', lat: 37.5678, lon: 126.9765, title: '보도블록 침하 주의', isMine: false },
  { id: 3, type: 'danger', lat: 37.5658, lon: 126.9790, title: '맨홀 뚜껑 파손', isMine: true },
  { id: 4, type: 'resolved', lat: 37.5685, lon: 126.9785, title: '균열 보수 완료', isMine: false },
  { id: 5, type: 'resolved', lat: 37.5668, lon: 126.9802, title: '가드레일 복구 완료', isMine: false }
];

let markerLayers = [];

// ==========================================
// 2. 지도 초기화 (워터마크 없는 깔끔한 타일)
// ==========================================
function initMap() {
  const mapEl = document.getElementById('map');
  if (!mapEl || map) return;

  // 서울 시청 중심 세팅
  map = L.map('map', {
    zoomControl: false // 커스텀 줌 버튼 사용
  }).setView([37.5665, 126.9780], 16);

  // 워터마크 없는 깨끗한 OSM 타일
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  // 지도 클릭 시 제보 위치 설정
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    document.getElementById('complaintLat').value = lat;
    document.getElementById('complaintLon').value = lng;
    document.getElementById('complaintLocation').value = `선택 위치 (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    openReportSheet();
  });

  // 우측 커스텀 줌 버튼 연동
  document.getElementById('btnZoomIn').addEventListener('click', () => map.zoomIn());
  document.getElementById('btnZoomOut').addEventListener('click', () => map.zoomOut());

  // GPS 버튼 클릭 시 현재 위치 이동
  document.getElementById('btnGpsCenter').addEventListener('click', moveToCurrentGps);

  renderMarkers();

  setTimeout(() => { if (map) map.invalidateSize(); }, 200);
}

// 스크린샷과 동일한 반투명 원형 후광 마커 생성
function createHaloIcon(type) {
  let haloClass = 'marker-halo-danger';
  let coreClass = 'core-danger';
  let iconText = '❗';

  if (type === 'warning') {
    haloClass = 'marker-halo-warning';
    coreClass = 'core-warning';
    iconText = '⚠️';
  } else if (type === 'resolved') {
    haloClass = 'marker-halo-resolved';
    coreClass = 'core-resolved';
    iconText = '✓';
  }

  return L.divIcon({
    className: 'custom-halo-marker',
    html: `
      <div class="marker-halo-wrapper">
        <div class="marker-halo ${haloClass}"></div>
        <div class="marker-core ${coreClass}">${iconText}</div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -20]
  });
}

// 필터링 적용된 마커 렌더링
function renderMarkers() {
  if (!map) return;

  // 기존 마커 제거
  markerLayers.forEach(layer => map.removeLayer(layer));
  markerLayers = [];

  const filtered = complaints.filter(c => {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'danger') return c.type === 'danger';
    if (currentFilter === 'warning') return c.type === 'warning';
    if (currentFilter === 'resolved') return c.type === 'resolved';
    if (currentFilter === 'my') return c.isMine;
    return true;
  });

  filtered.forEach(c => {
    const marker = L.marker([c.lat, c.lon], { icon: createHaloIcon(c.type) })
      .addTo(map)
      .bindPopup(`
        <div style="font-size:12px; font-weight:700; color:#0f172a; padding:4px;">
          <span style="color:${c.type === 'danger' ? '#ff4757' : c.type === 'warning' ? '#ffa502' : '#2ed573'};">
            ● ${c.type.toUpperCase()}
          </span><br>
          ${c.title}
        </div>
      `);
    markerLayers.push(marker);
  });
}

// ==========================================
// 3. 필터 버튼 이벤트
// ==========================================
function initFilterEvents() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderMarkers();
    });
  });
}

// ==========================================
// 4. 모달 & 바텀시트 제어
// ==========================================
function openReportSheet() {
  document.getElementById('reportSheetBackdrop').style.display = 'flex';
}

function closeReportSheet() {
  document.getElementById('reportSheetBackdrop').style.display = 'none';
}

function openRouteModal() {
  document.getElementById('routeModalBackdrop').style.display = 'flex';
}

function closeRouteModal() {
  document.getElementById('routeModalBackdrop').style.display = 'none';
}

function openSubView(title, html) {
  document.getElementById('subViewTitle').textContent = title;
  document.getElementById('subViewContent').innerHTML = html;
  document.getElementById('subViewBackdrop').style.display = 'flex';
}

function closeSubView() {
  document.getElementById('subViewBackdrop').style.display = 'none';
}

// ==========================================
// 5. GPS 위치 이동
// ==========================================
function moveToCurrentGps() {
  if (!navigator.geolocation) {
    alert('이 브라우저는 GPS를 지원하지 않습니다.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      map.setView([userCoords.lat, userCoords.lon], 16);
      document.getElementById('startLat').value = userCoords.lat;
      document.getElementById('startLon').value = userCoords.lon;
      document.getElementById('startInput').value = '내 현재 GPS 위치';
    },
    (err) => alert(`GPS 위치를 가져올 수 없습니다: ${err.message}`)
  );
}

// ==========================================
// 6. Gemini Vision AI 사진 제보 및 포인트 지급
// ==========================================
function initMediaControls() {
  const cameraInput = document.getElementById('cameraInput');
  const galleryInput = document.getElementById('galleryInput');

  [cameraInput, galleryInput].forEach(input => {
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
        if (match) {
          currentMimeType = match[1];
          currentBase64Image = match[2];
          document.getElementById('imagePreview').src = dataUrl;
          document.getElementById('previewContainer').style.display = 'block';
        }
      };
      reader.readAsDataURL(file);
    });
  });

  document.getElementById('removeImgBtn').addEventListener('click', () => {
    cameraInput.value = '';
    galleryInput.value = '';
    currentBase64Image = null;
    currentMimeType = null;
    document.getElementById('previewContainer').style.display = 'none';
  });
}

async function handleComplaintSubmit(e) {
  e.preventDefault();

  if (!currentBase64Image) {
    alert('카메라 촬영 또는 사진첩에서 현장 사진을 등록해 주세요.');
    return;
  }

  const loc = document.getElementById('complaintLocation').value.trim();
  const notes = document.getElementById('complaintNotes').value.trim();
  const lat = parseFloat(document.getElementById('complaintLat').value) || 37.5665;
  const lon = parseFloat(document.getElementById('complaintLon').value) || 126.9780;
  const btn = document.getElementById('submitComplaintBtn');

  btn.disabled = true;
  btn.textContent = 'AI가 현장 사진 판독 중...';

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: currentBase64Image,
        mimeType: currentMimeType,
        location: loc,
        notes: notes
      })
    });

    const analysis = res.ok ? await res.json() : { riskLevel: '주의', summary: '노면 파손' };

    // 위험도 타입 변환
    let type = 'warning';
    if (analysis.riskLevel === '긴급') type = 'danger';
    else if (analysis.riskLevel === '보통') type = 'resolved';

    // 신규 민원 마커 추가
    complaints.unshift({
      id: Date.now(),
      type: type,
      lat: lat,
      lon: lon,
      title: analysis.summary || '도로 위험 제보',
      isMine: true
    });

    renderMarkers();

    // 포인트 지급 (+100 P)
    userPoints += 100;
    document.getElementById('userPoints').textContent = `${userPoints.toLocaleString()} P`;

    closeReportSheet();
    document.getElementById('removeImgBtn').click();
    document.getElementById('complaintNotes').value = '';

    alert(`🎉 제보가 성공적으로 접수되었습니다!\n[AI 판독]: ${analysis.summary}\n보상으로 100 P가 적립되었습니다.`);
  } catch (err) {
    alert('제보 중 오류가 발생했습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gemini AI 자동 판독 & 제보하기 (+100 P)';
  }
}

// ==========================================
// 7. TMAP 보행자 길찾기 연동
// ==========================================
async function searchPedestrianRoute(e) {
  if (e) e.preventDefault();

  const startName = document.getElementById('startInput').value.trim();
  const endName = document.getElementById('endInput').value.trim();
  const startLat = parseFloat(document.getElementById('startLat').value);
  const startLon = parseFloat(document.getElementById('startLon').value);
  const endLat = parseFloat(document.getElementById('endLat').value);
  const endLon = parseFloat(document.getElementById('endLon').value);
  const btn = document.getElementById('searchRouteBtn');

  btn.disabled = true;
  btn.textContent = '경로 탐색 중...';

  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startX: startLon.toString(),
        startY: startLat.toString(),
        endX: endLon.toString(),
        endY: endLat.toString(),
        reqCoordType: 'WGS84GEO',
        resCoordType: 'WGS84GEO',
        startName: startName || '출발지',
        endName: endName || '도착지'
      })
    });

    const data = await res.json();
    const coords = [];
    const features = data.features || [];

    features.forEach(f => {
      if (f.geometry.type === 'LineString') {
        f.geometry.coordinates.forEach(pt => coords.push([pt[1], pt[0]]));
      }
    });

    if (routePolyline) map.removeLayer(routePolyline);

    // 민트색 보행자 경로선 렌더링
    routePolyline = L.polyline(coords, {
      color: '#00b894',
      weight: 6,
      opacity: 0.9
    }).addTo(map);

    map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });

    const totalDist = features[0]?.properties?.totalDistance || 0;
    const totalTime = Math.round((features[0]?.properties?.totalTime || 0) / 60);

    document.getElementById('routeBarText').textContent = `${(totalDist / 1000).toFixed(1)}km · 약 ${totalTime}분 보행 소요`;
    closeRouteModal();
  } catch (err) {
    alert('경로 탐색에 실패했습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = '안전 경로 탐색';
  }
}

// POI 자동완성
function setupPoi(inputId, listId, onSelect) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      list.style.display = 'none';
      return;
    }

    timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/poi?keyword=${encodeURIComponent(q)}`);
        const results = await res.json();
        if (results.length === 0) {
          list.style.display = 'none';
          return;
        }

        list.innerHTML = results.map(r => `
          <li class="poi-item" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${r.name}">
            <div class="poi-name">${r.name}</div>
            <div class="poi-addr">${r.address}</div>
          </li>
        `).join('');
        list.style.display = 'block';

        list.querySelectorAll('.poi-item').forEach(li => {
          li.addEventListener('click', () => {
            input.value = li.dataset.name;
            list.style.display = 'none';
            onSelect(parseFloat(li.dataset.lat), parseFloat(li.dataset.lon), li.dataset.name);
          });
        });
      } catch (e) {
        list.style.display = 'none';
      }
    }, 250);
  });
}

// ==========================================
// 8. 하단 탭바 이벤트 (랭킹 / 스토어 / 설정)
// ==========================================
function initBottomTabs() {
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      const type = tab.dataset.tab;
      document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      if (type === 'rank') {
        openSubView('🏆 실시간 도로안전 랭킹', `
          <div class="rank-item"><div class="rank-user"><span class="rank-num">1</span> 🥇 안전지킴이_손민기</div><span class="rank-points">8,450 P</span></div>
          <div class="rank-item"><div class="rank-user"><span class="rank-num">2</span> 🥈 안산도로파수꾼</div><span class="rank-points">6,120 P</span></div>
          <div class="rank-item"><div class="rank-user"><span class="rank-num">3</span> 🥉 걷기왕김철수</div><span class="rank-points">4,900 P</span></div>
          <div class="rank-item" style="border: 2px solid #00b894;"><div class="rank-user"><span class="rank-num">4</span> ⭐ 나 (현재 순위)</div><span class="rank-points">${userPoints.toLocaleString()} P</span></div>
        `);
      } else if (type === 'store') {
        openSubView('🎁 리워드 스토어', `
          <div class="rank-item"><div><b>스타벅스 아메리카노</b><br><small style="color:#64748b;">4,500 P 교환권</small></div><button class="btn-sm-action">교환</button></div>
          <div class="rank-item"><div><b>CU 5,000원 상품권</b><br><small style="color:#64748b;">5,000 P 교환권</small></div><button class="btn-sm-action">교환</button></div>
          <div class="rank-item"><div><b>교통카드 10,000원 충전</b><br><small style="color:#64748b;">10,000 P 교환권</small></div><button class="btn-sm-action">교환</button></div>
        `);
      } else if (type === 'settings') {
        openSubView('⚙️ 시스템 설정', `
          <div class="rank-item"><span>실시간 위험 알림 푸시</span><input type="checkbox" checked style="accent-color:#00b894;"></div>
          <div class="rank-item"><span>지도 고화질 모드</span><input type="checkbox" checked style="accent-color:#00b894;"></div>
          <div class="rank-item"><span>앱 버전</span><span style="color:#64748b;">v2.4.0 (최신)</span></div>
        `);
      }
    });
  });

  // FAB 제보 버튼
  document.getElementById('btnOpenReportSheet').addEventListener('click', openReportSheet);
  document.getElementById('btnCloseReportSheet').addEventListener('click', closeReportSheet);

  // 길찾기 버튼
  document.getElementById('btnOpenRouteModal').addEventListener('click', openRouteModal);
  document.getElementById('btnCloseRouteModal').addEventListener('click', closeRouteModal);

  // 서브뷰 닫기
  document.getElementById('btnCloseSubView').addEventListener('click', () => {
    closeSubView();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-tab="map"]').classList.add('active');
  });
}

// ==========================================
// 9. 앱 가동
// ==========================================
function startApp() {
  initMap();
  initFilterEvents();
  initMediaControls();
  initBottomTabs();

  setupPoi('startInput', 'startPoiList', (lat, lon) => {
    document.getElementById('startLat').value = lat;
    document.getElementById('startLon').value = lon;
  });

  setupPoi('endInput', 'endPoiList', (lat, lon) => {
    document.getElementById('endLat').value = lat;
    document.getElementById('endLon').value = lon;
  });

  document.getElementById('btnGpsStart').addEventListener('click', moveToCurrentGps);
  document.getElementById('routeForm').addEventListener('submit', searchPedestrianRoute);
  document.getElementById('complaintForm').addEventListener('submit', handleComplaintSubmit);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
