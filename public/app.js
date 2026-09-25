let map = null;
let routePolyline = null;
let startMarker = null;
let endMarker = null;
let complaintMarkers = [];

let currentBase64Image = null;
let currentMimeType = null;
let complaintsData = [];

// ==========================================
// 1. 모바일 탭 전환
// ==========================================
function initMobileTabs() {
  const tabBtns = document.querySelectorAll('.mobile-tab-nav .tab-btn');
  const leftPanel = document.querySelector('.left-panel');
  const rightPanel = document.querySelector('.right-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.dataset.target;
      if (target === 'left-panel') {
        leftPanel.classList.add('active-panel');
        rightPanel.classList.remove('active-panel');
        if (map) setTimeout(() => map.invalidateSize(), 150);
      } else {
        rightPanel.classList.add('active-panel');
        leftPanel.classList.remove('active-panel');
      }
    });
  });
}

function switchTab(targetName) {
  const targetBtn = document.querySelector(`.mobile-tab-nav .tab-btn[data-target="${targetName}"]`);
  if (targetBtn) targetBtn.click();
}

// ==========================================
// 2. OpenStreetMap 지도 초기화 (안정성 강화)
// ==========================================
function initMap() {
  const mapEl = document.getElementById('map');
  if (!mapEl || map) return;

  try {
    map = L.map('map', { zoomControl: true }).setView([37.5565, 126.9740], 15);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    map.on('click', (e) => {
      setComplaintCoords(e.latlng.lat, e.latlng.lng, `선택 위치 (${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)})`);
    });

    // 화면 렌더링 타이밍 보정 (검은 화면 방지)
    setTimeout(() => { if (map) map.invalidateSize(); }, 150);
    setTimeout(() => { if (map) map.invalidateSize(); }, 500);
  } catch (err) {
    console.error('지도 렌더링 실패:', err);
  }
}

function createPinIcon(type, emoji) {
  return L.divIcon({
    className: 'custom-pin-wrapper',
    html: `<div class="map-pin pin-${type}">${emoji}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18]
  });
}

// ==========================================
// 3. TMAP 보행자 길찾기 (Node 서버 호출)
// ==========================================
async function searchPedestrianRoute(e) {
  if (e) e.preventDefault();

  const startName = document.getElementById('startInput').value.trim();
  const endName = document.getElementById('endInput').value.trim();
  const startLat = parseFloat(document.getElementById('startLat').value);
  const startLon = parseFloat(document.getElementById('startLon').value);
  const endLat = parseFloat(document.getElementById('endLat').value);
  const endLon = parseFloat(document.getElementById('endLon').value);

  const searchBtn = document.getElementById('searchRouteBtn');
  searchBtn.disabled = true;
  searchBtn.textContent = '보행자 경로 계산 중...';

  const payload = {
    startX: startLon.toString(),
    startY: startLat.toString(),
    endX: endLon.toString(),
    endY: endLat.toString(),
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    startName: startName || '출발지',
    endName: endName || '도착지'
  };

  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('서버 응답 오류');
    const data = await res.json();
    renderRoute(data, startLat, startLon, endLat, endLon, startName, endName);
  } catch (err) {
    console.warn('경로 응답 실패:', err);
    alert('보행자 경로 탐색에 실패했습니다.');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '보행자 경로 탐색';
  }
}

function renderRoute(data, sLat, sLon, eLat, eLon, sName, eName) {
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

  const totalDist = features[0]?.properties?.totalDistance || 0;
  const totalTime = Math.round((features[0]?.properties?.totalTime || 0) / 60);

  if (routePolyline) map.removeLayer(routePolyline);
  if (startMarker) map.removeLayer(startMarker);
  if (endMarker) map.removeLayer(endMarker);

  routePolyline = L.polyline(coords, { color: '#2563eb', weight: 6, opacity: 0.85 }).addTo(map);

  startMarker = L.marker([sLat, sLon], { icon: createPinIcon('start', '출') }).addTo(map).bindPopup(`<b>출발:</b> ${sName}`);
  endMarker = L.marker([eLat, eLon], { icon: createPinIcon('end', '도') }).addTo(map).bindPopup(`<b>도착:</b> ${eName}`);

  map.fitBounds(routePolyline.getBounds(), { padding: [30, 30] });

  document.getElementById('summaryDistance').textContent = totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${totalDist} m`;
  document.getElementById('summaryTime').textContent = `${totalTime}분`;
  document.getElementById('routeSummary').style.display = 'grid';

  document.getElementById('routeStepsList').innerHTML = steps.map((s, idx) => `
    <li class="step-item">
      <span class="step-index">${idx + 1}</span>
      <span class="step-desc">${s}</span>
    </li>
  `).join('');
}

// ==========================================
// 4. 지도 위 민원 마커 표시
// ==========================================
function addComplaintMarkerToMap(complaint) {
  let pinType = 'normal';
  let emoji = '🟢';
  if (complaint.riskLevel === '긴급') { pinType = 'danger'; emoji = '🚨'; }
  else if (complaint.riskLevel === '주의') { pinType = 'warning'; emoji = '⚠️'; }

  const marker = L.marker([complaint.lat, complaint.lon], { icon: createPinIcon(pinType, emoji) }).addTo(map);

  marker.bindPopup(`
    <div style="font-size: 0.85rem; line-height: 1.4; color: #0f172a;">
      <b style="color: ${complaint.riskLevel === '긴급' ? '#dc2626' : '#d97706'}">[${complaint.riskLevel}] ${complaint.category}</b><br>
      <b>위치:</b> ${complaint.location}<br>
      <b>요약:</b> ${complaint.summary}<br>
      <b>조치 권고:</b> ${complaint.action}
    </div>
  `);

  complaintMarkers.push({ id: complaint.id, marker });
  marker.openPopup();
  map.panTo([complaint.lat, complaint.lon]);
}

window.focusComplaintOnMap = function(id) {
  switchTab('left-panel');
  setTimeout(() => {
    const target = complaintMarkers.find(c => c.id === id);
    if (target && target.marker && map) {
      map.setView(target.marker.getLatLng(), 17);
      target.marker.openPopup();
    }
  }, 150);
};

// ==========================================
// 5. TMAP POI 실시간 검색 (Node 서버 호출)
// ==========================================
async function searchTmapPoi(keyword) {
  if (!keyword || keyword.trim().length < 2) return [];

  try {
    const res = await fetch(`/api/poi?keyword=${encodeURIComponent(keyword)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

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
      const results = await searchTmapPoi(q);
      if (results.length === 0) {
        list.style.display = 'none';
        return;
      }
      list.innerHTML = results.map(r => `
        <li class="poi-item" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${r.name}">
          <span class="poi-name">${r.name}</span>
          <span class="poi-addr">${r.address}</span>
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
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.style.display = 'none';
    }
  });
}

function setComplaintCoords(lat, lon, label) {
  document.getElementById('complaintLat').value = lat;
  document.getElementById('complaintLon').value = lon;
  if (label) document.getElementById('complaintLocation').value = label;
}

// ==========================================
// 6. 카메라 & 사진첩 파일 제어
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
          document.getElementById('previewContainer').style.display = 'flex';
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
    document.getElementById('imagePreview').src = '';
  });
}

// ==========================================
// 7. Gemini Vision AI 판독 & 민원 접수
// ==========================================
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

    if (!res.ok) throw new Error('AI 분석 요청 실패');
    const analysis = await res.json();

    const newComplaint = {
      id: Date.now(),
      imageSrc: `data:${currentMimeType};base64,${currentBase64Image}`,
      location: loc,
      lat: lat,
      lon: lon,
      riskLevel: analysis.riskLevel || '보통',
      category: analysis.category || '기타',
      summary: analysis.summary || '민원 접수 완료',
      visualFindings: analysis.visualFindings || '현장 점검 필요',
      action: analysis.action || '긴급 안전 조치 요망',
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };

    complaintsData.unshift(newComplaint);
    renderComplaints();
    addComplaintMarkerToMap(newComplaint);

    document.getElementById('removeImgBtn').click();
    document.getElementById('complaintNotes').value = '';
    alert('민원이 정상 등록되었습니다!');
  } catch (err) {
    alert('민원 접수 중 오류가 발생했습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = '사진 AI 자동 분석 및 제보';
  }
}

function renderComplaints() {
  const count = document.getElementById('complaintCount');
  const mobileCount = document.getElementById('mobileCount');
  const list = document.getElementById('complaintsList');

  count.textContent = `${complaintsData.length}건`;
  if (mobileCount) mobileCount.textContent = `${complaintsData.length}`;

  if (complaintsData.length === 0) {
    list.innerHTML = '<div class="empty-state">접수된 민원이 없습니다.</div>';
    return;
  }

  list.innerHTML = complaintsData.map(c => `
    <article class="complaint-card">
      <div class="card-top">
        <div class="card-meta">
          <span class="badge ${c.riskLevel === '긴급' ? 'badge-danger' : c.riskLevel === '주의' ? 'badge-warning' : 'badge-normal'}">${c.riskLevel}</span>
          <span class="badge badge-category">${c.category}</span>
          <span class="card-location">📍 ${c.location}</span>
        </div>
        <span class="card-time">${c.time}</span>
      </div>
      <div class="card-body-layout">
        <img src="${c.imageSrc}" class="card-thumbnail">
        <div class="card-details">
          <div class="card-summary">${c.summary}</div>
          <div class="card-vision-desc">🔍 판독: ${c.visualFindings}</div>
          <div class="card-action">🚨 권고: ${c.action}</div>
          <button type="button" class="btn-view-map" onclick="focusComplaintOnMap(${c.id})">🗺️ 지도 위치 보기</button>
        </div>
      </div>
    </article>
  `).join('');
}

// ==========================================
// 8. 앱 실행 진입점 (이벤트 타이밍 무관 강제 가동)
// ==========================================
function startApp() {
  initMap();
  initMediaControls();
  initMobileTabs();

  setupPoi('startInput', 'startPoiList', (lat, lon) => {
    document.getElementById('startLat').value = lat;
    document.getElementById('startLon').value = lon;
  });

  setupPoi('endInput', 'endPoiList', (lat, lon) => {
    document.getElementById('endLat').value = lat;
    document.getElementById('endLon').value = lon;
  });

  setupPoi('complaintLocation', 'complaintPoiList', (lat, lon, name) => {
    setComplaintCoords(lat, lon, name);
    map.panTo([lat, lon]);
  });

  document.getElementById('btnGpsStart').addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('GPS를 지원하지 않는 브라우저입니다.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        document.getElementById('startInput').value = '내 현재 GPS 위치';
        document.getElementById('startLat').value = latitude;
        document.getElementById('startLon').value = longitude;
        map.setView([latitude, longitude], 16);
      },
      (err) => alert(`GPS 확인 불가: ${err.message}`)
    );
  });

  document.getElementById('routeForm').addEventListener('submit', searchPedestrianRoute);
  document.getElementById('complaintForm').addEventListener('submit', handleComplaintSubmit);

  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });
}

// 브라우저 로딩 상태와 무관하게 100% 실행 보장
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
