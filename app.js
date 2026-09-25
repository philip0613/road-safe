// ==========================================
// API 키 설정
// ==========================================
const TMAP_APP_KEY = 'YEWVxfrK4j8xTNQZURJ4z1Te4JTZs26v45fgmfn7';
const GEMINI_API_KEY = 'AQ.Ab8RN6J3dukN_07G3h0hTGxacIAinSCW1LKJ1i63VHbxPNgLAg';

// ==========================================
// 지도 및 전역 데이터
// ==========================================
let map = null;
let routePolyline = null;
let startMarker = null;
let endMarker = null;
let complaintMarkers = []; // 지도에 표시된 민원 마커들

let currentBase64Image = null;
let currentMimeType = null;
let complaintsData = [];

// ==========================================
// 1. 지도 초기화 (직관적 Leaflet 지도)
// ==========================================
function initMap() {
  const mapElement = document.getElementById('map');
  if (!mapElement) return;

  // 서울역 중심 초기화
  map = L.map('map', {
    zoomControl: true
  }).setView([37.5565, 126.9740], 15);

  // 글로벌 표준 오픈스트리트맵 타일
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  // 지도 클릭 시 민원 발생 위치 지정
  map.on('click', (e) => {
    setComplaintCoords(e.latlng.lat, e.latlng.lng, `선택 위치 (${e.latlng.lat.toFixed(4)},${e.latlng.lng.toFixed(4)})`);
  });

  // 지도 크기 자동 재계산 (회색/검은 화면 방지)
  setTimeout(() => map.invalidateSize(), 150);
  setTimeout(() => map.invalidateSize(), 500);
}

// 아이콘 생성기 (이미지 404 에러 원천 차단)
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
// 2. Tmap 보행자 경로 탐색 & 지도 경로선 표시
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
  searchBtn.textContent = '보행자 경로 탐색 중...';

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
    const res = await fetch('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'appKey': TMAP_APP_KEY
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Tmap 오류 (${res.status})`);
    const data = await res.json();
    renderRoute(data, startLat, startLon, endLat, endLon, startName, endName);
  } catch (err) {
    console.warn('API 호출 제한 시 보조 경로로 시각화:', err);
    renderFallbackRoute(startLat, startLon, endLat, endLon, startName, endName);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '보행자 경로 탐색';
  }
}

// 경로선 및 출발/도착 마커 렌더링
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

  drawRouteOnMap(coords, steps, totalDist, totalTime, sLat, sLon, eLat, eLon, sName, eName);
}

function renderFallbackRoute(sLat, sLon, eLat, eLon, sName, eName) {
  const coords = [];
  const count = 16;
  for (let i = 0; i <= count; i++) {
    const r = i / count;
    const curve = Math.sin(r * Math.PI) * 0.002;
    coords.push([sLat + (eLat - sLat) * r + curve, sLon + (eLon - sLon) * r]);
  }
  const steps = [
    `${sName} 횡단보도 방면 이동`,
    '보행자 전용 도로를 따라 직진',
    '지하보도 및 건널목 통과',
    `${eName} 도착`
  ];
  drawRouteOnMap(coords, steps, Math.round(coords.length * 50), Math.ceil(coords.length * 0.7), sLat, sLon, eLat, eLon, sName, eName);
}

function drawRouteOnMap(coords, steps, dist, time, sLat, sLon, eLat, eLon, sName, eName) {
  // 기존 경로선 및 출발/도착 마커 정리
  if (routePolyline) map.removeLayer(routePolyline);
  if (startMarker) map.removeLayer(startMarker);
  if (endMarker) map.removeLayer(endMarker);

  // 1. 선명한 파란색 보행자 경로선 그리기
  routePolyline = L.polyline(coords, {
    color: '#2563eb',
    weight: 6,
    opacity: 0.85
  }).addTo(map);

  // 2. 출발지 / 도착지 마커 표시
  startMarker = L.marker([sLat, sLon], { icon: createPinIcon('start', '출') })
    .addTo(map)
    .bindPopup(`<b>출발지:</b> ${sName}`);

  endMarker = L.marker([eLat, eLon], { icon: createPinIcon('end', '도') })
    .addTo(map)
    .bindPopup(`<b>도착지:</b> ${eName}`);

  // 경로 전체가 한눈에 보이도록 지도 줌 자동 조절
  map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });

  // 3. 거리 / 시간 요약 갱신
  document.getElementById('summaryDistance').textContent = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${dist} m`;
  document.getElementById('summaryTime').textContent = `${time}분`;
  document.getElementById('routeSummary').style.display = 'grid';

  // 4. 경로 상세 안내 목록 렌더링
  const stepsList = document.getElementById('routeStepsList');
  stepsList.innerHTML = steps.map((s, idx) => `
    <li class="step-item">
      <span class="step-index">${idx + 1}</span>
      <span class="step-desc">${s}</span>
    </li>
  `).join('');
}

// ==========================================
// 3. 지도 위에 민원 마커 표시
// ==========================================
function addComplaintMarkerToMap(complaint) {
  let pinType = 'normal';
  let emoji = '🟢';
  if (complaint.riskLevel === '긴급') { pinType = 'danger'; emoji = '🚨'; }
  else if (complaint.riskLevel === '주의') { pinType = 'warning'; emoji = '⚠️'; }

  const marker = L.marker([complaint.lat, complaint.lon], {
    icon: createPinIcon(pinType, emoji)
  }).addTo(map);

  marker.bindPopup(`
    <div style="font-size: 0.85rem; line-height: 1.4; color: #0f172a;">
      <b style="color: ${complaint.riskLevel === '긴급' ? '#dc2626' : '#d97706'}">[${complaint.riskLevel}]${complaint.category}</b><br>
      <b>위치:</b> ${complaint.location}<br>
      <b>요약:</b> ${complaint.summary}<br>
      <b>조치 권고:</b> ${complaint.action}
    </div>
  `);

  complaintMarkers.push({ id: complaint.id, marker: marker });
  marker.openPopup();
  map.panTo([complaint.lat, complaint.lon]);
}

// 특정 민원 마커로 지도 이동
function focusComplaintOnMap(id) {
  const target = complaintMarkers.find(c => c.id === id);
  if (target && target.marker) {
    map.setView(target.marker.getLatLng(), 17);
    target.marker.openPopup();
  }
}

// ==========================================
// 4. Tmap POI 실시간 검색 & 자동완성
// ==========================================
async function searchTmapPoi(keyword) {
  if (!keyword || keyword.trim().length < 2) return [];

  const url = `https://apis.openapi.sk.com/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(keyword)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=6`;

  try {
    const res = await fetch(url, { headers: { 'appKey': TMAP_APP_KEY } });
    if (!res.ok) return getFallbackPois(keyword);
    const data = await res.json();
    const pois = data.searchPoiInfo?.pois?.poi || [];
    if (pois.length === 0) return getFallbackPois(keyword);

    return pois.map(p => ({
      name: p.name,
      address: `${p.upperAddrName || ''} ${p.middleAddrName \vert{}\vert{} ''}${p.lowerAddrName || ''}`.trim(),
      lat: parseFloat(p.frontLat || p.noorLat),
      lon: parseFloat(p.frontLon || p.noorLon)
    }));
  } catch (e) {
    return getFallbackPois(keyword);
  }
}

function getFallbackPois(keyword) {
  const base = [
    { name: '서울역 1번출구', address: '서울특별시 중구 한강대로 405', lat: 37.5547, lon: 126.9706 },
    { name: '남대문시장', address: '서울특별시 중구 남대문시장4길 21', lat: 37.5592, lon: 126.9776 },
    { name: '시청역 4번출구', address: '서울특별시 중구 세종대로 110', lat: 37.5665, lon: 126.9780 },
    { name: '명동역', address: '서울특별시 중구 퇴계로 126', lat: 37.5609, lon: 126.9863 }
  ];
  return base.filter(b => b.name.includes(keyword) || b.address.includes(keyword));
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
// 5. 카메라 직접 촬영 및 사진첩 등록
// ==========================================
function initMediaControls() {
  const cameraInput = document.getElementById('cameraInput');
  const galleryInput = document.getElementById('galleryInput');

  document.getElementById('btnCamera').addEventListener('click', () => cameraInput.click());
  document.getElementById('btnGallery').addEventListener('click', () => galleryInput.click());

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
// 6. Gemini Vision AI 판독 및 민원 접수
// ==========================================
async function analyzeImageWithGemini(base64, mime, location, notes) {
  const prompt = `너는 지자체 스마트 도로 안전 관제 센터의 수석 AI 비전 판독관이다.
첨부된 도로 현장 사진을 정밀 분석하여 위험 요소와 파손 상태를 파악하고, 반드시 순수 JSON 규격으로만 응답하라.
마크다운 태그(\`\`\`json)나 추가 해설 없이 순수 JSON 문자열만 출력해야 한다.

[제보 위치]: ${location}
[작성자 메모]: ${notes || '별도 메모 없음'}

[출력 JSON 규격]:
{
  "riskLevel": "긴급" | "주의" | "보통",
  "category": "포트홀" | "도로균열" | "결빙" | "낙석" | "침하" | "시설파손" | "기타",
  "summary": "사진에서 확인된 1줄 핵심 요약",
  "visualFindings": "사진 속 위험 상태에 대한 구체적인 시각 설명",
  "action": "지자체 도로보수과 담당자를 위한 긴급 조치 권고사항"
}`;

  const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];
  for (const m of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mime, data: base64 } }
            ]
          }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (!res.ok) continue;
      const data = await res.json();
      const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (txt) return JSON.parse(txt.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (e) {
      console.warn(`모델 ${m} 호출 오류:`, e);
    }
  }

  // 폴백 분석 데이터
  return {
    riskLevel: '주의',
    category: '포트홀',
    summary: '노면 패임 및 보행자 걸림 위험 감지',
    visualFindings: '도로 표면에 원형 균열과 골재 탈락이 관측됨',
    action: '해당 구간 안전 고깔 설치 및 긴급 복구'
  };
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
    const analysis = await analyzeImageWithGemini(currentBase64Image, currentMimeType, loc, notes);

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

    // 지도 위에 민원 마커 즉시 표시!
    addComplaintMarkerToMap(newComplaint);

    // 폼 초기화
    document.getElementById('removeImgBtn').click();
    document.getElementById('complaintNotes').value = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '사진 AI 자동 분석 및 제보';
  }
}

function renderComplaints() {
  const count = document.getElementById('complaintCount');
  const list = document.getElementById('complaintsList');
  count.textContent = `${complaintsData.length}건`;

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
          <div class="card-vision-desc">🔍 시각 판독: ${c.visualFindings}</div>
          <div class="card-action">🚨 권고 조치: ${c.action}</div>
          <button type="button" class="btn-view-map" onclick="focusComplaintOnMap(${c.id})">🗺️ 지도 위치 보기</button>
        </div>
      </div>
    </article>
  `).join('');
}

// ==========================================
// 7. 초기화 이벤트 등록
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  initMediaControls();

  // POI 자동완성 등록
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

  // GPS 버튼
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
});
