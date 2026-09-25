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

// 마커 데이터
let complaints = [
  { id: 1, type: 'danger', lat: 37.5670, lon: 126.9772, title: '대형 포트홀 위험 (긴급 복구 요망)', isMine: false, time: '10분 전' },
  { id: 2, type: 'warning', lat: 37.5678, lon: 126.9765, title: '보도블록 침하로 인한 걸림 주의', isMine: false, time: '25분 전' },
  { id: 3, type: 'danger', lat: 37.5658, lon: 126.9790, title: '맨홀 뚜껑 파손 및 이탈', isMine: true, time: '1시간 전' },
  { id: 4, type: 'resolved', lat: 37.5685, lon: 126.9785, title: '균열 아스팔트 포장 보수 완료', isMine: false, time: '어제' },
  { id: 5, type: 'resolved', lat: 37.5668, lon: 126.9802, title: '가드레일 파손 복구 완료', isMine: false, time: '2일 전' }
];

let markerLayers = [];

// ==========================================
// 2. 지도 초기화
// ==========================================
function initMap() {
  const mapEl = document.getElementById('map');
  if (!mapEl || map) return;

  map = L.map('map', {
    zoomControl: false
  }).setView([37.5665, 126.9780], 16);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    document.getElementById('complaintLat').value = lat;
    document.getElementById('complaintLon').value = lng;
    document.getElementById('complaintLocation').value = `선택 위치 (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    openReportModal();
  });

  document.getElementById('btnZoomIn').addEventListener('click', () => map.zoomIn());
  document.getElementById('btnZoomOut').addEventListener('click', () => map.zoomOut());
  document.getElementById('btnGpsCenter').addEventListener('click', moveToCurrentGps);

  renderMarkers();
  renderDesktopComplaintsList();

  setTimeout(() => { if (map) map.invalidateSize(); }, 200);
}

// 스크린샷과 동일한 반투명 원형 후광 마커
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

function renderMarkers() {
  if (!map) return;

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

function renderDesktopComplaintsList() {
  const listEl = document.getElementById('desktopComplaintsList');
  if (!listEl) return;

  if (complaints.length === 0) {
    listEl.innerHTML = '<div class="empty-state">접수된 민원이 없습니다.</div>';
    return;
  }

  listEl.innerHTML = complaints.map(c => `
    <div class="complaint-pc-card" onclick="focusComplaint(${c.lat}, ${c.lon})">
      <div class="c-header">
        <span style="color:${c.type === 'danger' ? '#ff4757' : c.type === 'warning' ? '#ffa502' : '#2ed573'};">
          ● ${c.type === 'danger' ? '위험' : c.type === 'warning' ? '주의' : '해결됨'}
        </span>
        <span style="color:#94a3b8;">${c.time}</span>
      </div>
      <div class="c-title">${c.title}</div>
    </div>
  `).join('');
}

window.focusComplaint = function(lat, lon) {
  if (map) {
    map.setView([lat, lon], 17);
  }
};

// ==========================================
// 3. 필터 동기화 (모바일 알약 & PC 사이드바)
// ==========================================
function initFilterEvents() {
  const allFilterButtons = document.querySelectorAll('.filter-btn, .filter-item-btn');
  allFilterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      currentFilter = filter;

      allFilterButtons.forEach(b => {
        if (b.dataset.filter === filter) b.classList.add('active');
        else b.classList.remove('active');
      });

      renderMarkers();
    });
  });
}

// ==========================================
// 4. PC 사이드바 탭 및 접기/펼치기
// ==========================================
function initDesktopSidebar() {
  const tabs = document.querySelectorAll('.sidebar-tab');
  const panes = {
    route: document.getElementById('paneRoute'),
    filter: document.getElementById('paneFilter'),
    list: document.getElementById('paneList')
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.tab;
      Object.keys(panes).forEach(k => {
        if (k === target) panes[k]?.classList.add('active');
        else panes[k]?.classList.remove('active');
      });
    });
  });

  const sidebar = document.getElementById('desktopSidebar');
  const toggleBtn = document.getElementById('btnSidebarToggle');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      toggleBtn.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
      setTimeout(() => { if (map) map.invalidateSize(); }, 320);
    });
  }
}

// ==========================================
// 5. 모달 및 바텀시트 제어
// ==========================================
function openReportModal() {
  document.getElementById('reportSheetBackdrop').style.display = 'flex';
}
function closeReportModal() {
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
// 6. GPS 위치 추적
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

      // 모바일 & PC 인풋 동시 세팅
      ['mStartLat', 'dStartLat'].forEach(id => { const el = document.getElementById(id); if (el) el.value = userCoords.lat; });
      ['mStartLon', 'dStartLon'].forEach(id => { const el = document.getElementById(id); if (el) el.value = userCoords.lon; });
      ['mStartInput', 'dStartInput'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '내 현재 GPS 위치'; });
    },
    (err) => alert(`GPS 위치를 가져올 수 없습니다: ${err.message}`)
  );
}

// ==========================================
// 7. Gemini Vision AI 사진 제보
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
  btn.textContent = 'Gemini AI 사진 판독 중...';

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

    let type = 'warning';
    if (analysis.riskLevel === '긴급') type = 'danger';
    else if (analysis.riskLevel === '보통') type = 'resolved';

    complaints.unshift({
      id: Date.now(),
      type: type,
      lat: lat,
      lon: lon,
      title: analysis.summary || '도로 위험 제보',
      isMine: true,
      time: '방금 전'
    });

    renderMarkers();
    renderDesktopComplaintsList();

    userPoints += 100;
    document.getElementById('userPoints').textContent = `${userPoints.toLocaleString()} P`;

    closeReportModal();
    document.getElementById('removeImgBtn').click();
    document.getElementById('complaintNotes').value = '';

    alert(`🎉 제보가 성공적으로 접수되었습니다!\n[AI 판독 결과]: ${analysis.summary}\n보상으로 100 P가 적립되었습니다.`);
  } catch (err) {
    alert('제보 중 오류가 발생했습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gemini AI 자동 판독 & 제보하기 (+100 P)';
  }
}

// ==========================================
// 8. TMAP 보행자 길찾기 연동 (모바일/PC 공용 함수)
// ==========================================
async function runPedestrianRoute(startName, endName, sLat, sLon, eLat, eLon, isDesktop) {
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startX: sLon.toString(),
        startY: sLat.toString(),
        endX: eLon.toString(),
        endY: eLat.toString(),
        reqCoordType: 'WGS84GEO',
        resCoordType: 'WGS84GEO',
        startName: startName || '출발지',
        endName: endName || '도착지'
      })
    });

    const data = await res.json();
    const coords = [];
    const steps = [];
    const features = data.features || [];

    features.forEach(f => {
      if (f.geometry.type === 'LineString') {
        f.geometry.coordinates.forEach(pt => coords.push([pt[1], pt[0]]));
      } else if (f.geometry.type === 'Point' && f.properties.description) {
        steps.push(f.properties.description);
      }
    });

    if (routePolyline) map.removeLayer(routePolyline);

    // 민트색 보행자 경로선
    routePolyline = L.polyline(coords, {
      color: '#00b894',
      weight: 6,
      opacity: 0.9
    }).addTo(map);

    map.fitBounds(routePolyline.getBounds(), { padding: [50, 50] });

    const totalDist = features[0]?.properties?.totalDistance || 0;
    const totalTime = Math.round((features[0]?.properties?.totalTime || 0) / 60);

    // 모바일 텍스트 갱신
    const mobileText = document.getElementById('routeBarText');
    if (mobileText) mobileText.textContent = `${(totalDist / 1000).toFixed(1)}km · 약 ${totalTime}분 보행`;

    // PC 사이드바 갱신
    const distEl = document.getElementById('dSummaryDist');
    const timeEl = document.getElementById('dSummaryTime');
    const summaryBox = document.getElementById('desktopRouteSummary');
    const stepsList = document.getElementById('dRouteStepsList');

    if (distEl) distEl.textContent = totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${totalDist} m`;
    if (timeEl) timeEl.textContent = `${totalTime}분`;
    if (summaryBox) summaryBox.style.display = 'grid';

    if (stepsList) {
      stepsList.innerHTML = steps.map((s, idx) => `
        <li class="step-item">
          <span class="step-index">${idx + 1}</span>
          <span>${s}</span>
        </li>
      `).join('');
    }

    if (!isDesktop) closeRouteModal();
  } catch (err) {
    alert('보행자 경로 탐색에 실패했습니다.');
  }
}

// POI 자동완성 바인딩
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
// 9. 하단 탭바 & 버튼 이벤트 초기화
// ==========================================
function initTabEvents() {
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
          <div class="rank-item"><span>앱 버전</span><span style="color:#64748b;">v2.5.0 (최신)</span></div>
        `);
      }
    });
  });

  // 모바일 제보 열기
  document.getElementById('btnOpenReportSheet').addEventListener('click', openReportModal);
  document.getElementById('btnCloseReportSheet').addEventListener('click', closeReportModal);

  // PC 제보 열기
  document.getElementById('btnDesktopReport').addEventListener('click', openReportModal);

  // 모바일 길찾기 열기
  document.getElementById('btnOpenRouteModal').addEventListener('click', openRouteModal);
  document.getElementById('btnCloseRouteModal').addEventListener('click', closeRouteModal);

  // 서브뷰 닫기
  document.getElementById('btnCloseSubView').addEventListener('click', () => {
    closeSubView();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-tab="map"]')?.classList.add('active');
  });

  // 모바일 길찾기 제출
  document.getElementById('mobileRouteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const sName = document.getElementById('mStartInput').value;
    const eName = document.getElementById('mEndInput').value;
    const sLat = parseFloat(document.getElementById('mStartLat').value);
    const sLon = parseFloat(document.getElementById('mStartLon').value);
    const eLat = parseFloat(document.getElementById('mEndLat').value);
    const eLon = parseFloat(document.getElementById('mEndLon').value);
    runPedestrianRoute(sName, eName, sLat, sLon, eLat, eLon, false);
  });

  // PC 길찾기 제출
  document.getElementById('desktopRouteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const sName = document.getElementById('dStartInput').value;
    const eName = document.getElementById('dEndInput').value;
    const sLat = parseFloat(document.getElementById('dStartLat').value);
    const sLon = parseFloat(document.getElementById('dStartLon').value);
    const eLat = parseFloat(document.getElementById('dEndLat').value);
    const eLon = parseFloat(document.getElementById('dEndLon').value);
    runPedestrianRoute(sName, eName, sLat, sLon, eLat, eLon, true);
  });
}

// ==========================================
// 10. 앱 부팅
// ==========================================
function startApp() {
  initMap();
  initFilterEvents();
  initDesktopSidebar();
  initMediaControls();
  initTabEvents();

  // POI 자동완성 연결 (모바일 & PC)
  setupPoi('mStartInput', 'mStartPoiList', (lat, lon) => {
    document.getElementById('mStartLat').value = lat;
    document.getElementById('mStartLon').value = lon;
  });
  setupPoi('mEndInput', 'mEndPoiList', (lat, lon) => {
    document.getElementById('mEndLat').value = lat;
    document.getElementById('mEndLon').value = lon;
  });
  setupPoi('dStartInput', 'dStartPoiList', (lat, lon) => {
    document.getElementById('dStartLat').value = lat;
    document.getElementById('dStartLon').value = lon;
  });
  setupPoi('dEndInput', 'dEndPoiList', (lat, lon) => {
    document.getElementById('dEndLat').value = lat;
    document.getElementById('dEndLon').value = lon;
  });

  document.getElementById('btnMobileGps').addEventListener('click', moveToCurrentGps);
  document.getElementById('btnDesktopGps').addEventListener('click', moveToCurrentGps);
  document.getElementById('complaintForm').addEventListener('submit', handleComplaintSubmit);

  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
