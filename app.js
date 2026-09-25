// ==========================================
// API 키 & 모델 설정
// ==========================================
const TMAP_APP_KEY = 'YEWVxfrK4j8xTNQZURJ4z1Te4JTZs26v45fgmfn7';
const GEMINI_API_KEY = 'AQ.Ab8RN6J3dukN_07G3h0hTGxacIAinSCW1LKJ1i63VHbxPNgLAg';
const GEMINI_MODEL = 'gemini-3.6-flash';

// ==========================================
// 지도 및 네비게이션 전역 상태
// ==========================================
let map = null;
let startMarker = null;
let endMarker = null;
let userMarker = null;
let complaintMarker = null;

// 네비게이션 경로 관리
let fullRouteCoords = [];      // 전체 경로 [[lat, lon], ...]
let remainingRouteCoords = []; // 남은 경로 [[lat, lon], ...]
let routePolyline = null;       // 지도에 표시되는 남은 경로 선
let passedPolyline = null;      // 지나온 길 (회색 선)
let guidePoints = [];           // 안내 지점들 [{point, desc}, ...]
let simInterval = null;         // 모의 주행 타이머
let watchId = null;             // 실시간 GPS 감시 ID

// 이미지 처리 데이터
let currentBase64Image = null;
let currentMimeType = null;
let complaintsData = [];

// ==========================================
// 1. 지도 초기화 (Leaflet & 다크 테마 타일)
// ==========================================
function initMap() {
  // 서울역 기본 좌표
  map = L.map('map').setView([37.5547, 126.9706], 15);

  // 다크 테마 타일 레이어
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap & CartoDB',
    maxZoom: 19
  }).addTo(map);

  // 지도 클릭 시 민원 발생 위치 자동 지정
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    setComplaintLocationFromCoords(lat, lng);
  });
}

// ==========================================
// 2. Tmap POI 실시간 검색 (검색어 자동 유추)
// ==========================================
async function searchTmapPoi(keyword) {
  if (!keyword || keyword.trim().length < 2) return [];

  const url = `https://apis.openapi.sk.com/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(keyword)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=6`;

  try {
    const response = await fetch(url, {
      headers: { 'appKey': TMAP_APP_KEY }
    });
    if (!response.ok) return [];

    const data = await response.json();
    const pois = data.searchPoiInfo?.pois?.poi || [];
    return pois.map(item => ({
      name: item.name,
      address: `${item.upperAddrName || ''} ${item.middleAddrName \vert{}\vert{} ''}${item.lowerAddrName || ''}`.trim(),
      lat: parseFloat(item.frontLat || item.noorLat),
      lon: parseFloat(item.frontLon || item.noorLon)
    }));
  } catch (err) {
    console.warn('POI 검색 오류:', err);
    return [];
  }
}

// 자동완성 드롭다운 바인딩 헬퍼
function setupPoiAutocomplete(inputEl, listEl, onSelect) {
  let debounceTimer = null;

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = inputEl.value.trim();

    if (query.length < 2) {
      listEl.style.display = 'none';
      listEl.innerHTML = '';
      return;
    }

    debounceTimer = setTimeout(async () => {
      const results = await searchTmapPoi(query);
      if (results.length === 0) {
        listEl.style.display = 'none';
        return;
      }

      listEl.innerHTML = results.map(item => `
        <li class="poi-item" data-lat="${item.lat}" data-lon="${item.lon}" data-name="${item.name}">
          <span class="poi-name">${item.name}</span>
          <span class="poi-addr">${item.address}</span>
        </li>
      `).join('');
      listEl.style.display = 'block';

      // 항목 클릭 이벤트
      listEl.querySelectorAll('.poi-item').forEach(li => {
        li.addEventListener('click', () => {
          const lat = parseFloat(li.dataset.lat);
          const lon = parseFloat(li.dataset.lon);
          const name = li.dataset.name;
          inputEl.value = name;
          listEl.style.display = 'none';
          onSelect(lat, lon, name);
        });
      });
    }, 280);
  });

  // 바깥 클릭 시 드롭다운 닫기
  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !listEl.contains(e.target)) {
      listEl.style.display = 'none';
    }
  });
}

// ==========================================
// 3. Tmap 보행자 경로 탐색 & 지도 시각화
// ==========================================
async function searchPedestrianRoute(e) {
  if (e) e.preventDefault();

  stopNavigation(); // 이전 네비 정지

  const startName = document.getElementById('startInput').value.trim();
  const endName = document.getElementById('endInput').value.trim();
  const startLat = parseFloat(document.getElementById('startLat').value);
  const startLon = parseFloat(document.getElementById('startLon').value);
  const endLat = parseFloat(document.getElementById('endLat').value);
  const endLon = parseFloat(document.getElementById('endLon').value);

  const searchBtn = document.getElementById('searchRouteBtn');
  searchBtn.disabled = true;
  searchBtn.textContent = '안전 경로 계산 중...';

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
    const response = await fetch('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'appKey': TMAP_APP_KEY
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`Tmap 오류 (${response.status})`);
    const data = await response.json();

    parseAndRenderRoute(data, startLat, startLon, endLat, endLon, startName, endName);
  } catch (err) {
    alert(`경로 탐색 실패: ${err.message}`);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '보행자 경로 탐색';
  }
}

// 경로 파싱 및 지도 표시
function parseAndRenderRoute(data, startLat, startLon, endLat, endLon, startName, endName) {
  fullRouteCoords = [];
  guidePoints = [];

  const features = data.features || [];
  features.forEach(f => {
    if (f.geometry.type === 'LineString') {
      // Tmap coordinates: [lon, lat] -> Leaflet: [lat, lon]
      f.geometry.coordinates.forEach(pt => {
        fullRouteCoords.push([pt[1], pt[0]]);
      });
    } else if (f.geometry.type === 'Point' && f.properties.description) {
      guidePoints.push({
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        desc: f.properties.description
      });
    }
  });

  remainingRouteCoords = [...fullRouteCoords];

  // 기존 폴리라인 및 마커 리셋
  if (routePolyline) map.removeLayer(routePolyline);
  if (passedPolyline) map.removeLayer(passedPolyline);
  if (startMarker) map.removeLayer(startMarker);
  if (endMarker) map.removeLayer(endMarker);

  // 지나온 길 선(반투명 회색)과 남은 길 선(발광 청록색)
  passedPolyline = L.polyline([], { color: '#64748b', weight: 5, opacity: 0.5 }).addTo(map);
  routePolyline = L.polyline(remainingRouteCoords, { color: '#38bdf8', weight: 6, opacity: 0.9 }).addTo(map);

  // 출발/도착 마커
  startMarker = L.marker([startLat, startLon]).addTo(map).bindPopup(`<b>출발:</b> ${startName}`);
  endMarker = L.marker([endLat, endLon]).addTo(map).bindPopup(`<b>도착:</b> ${endName}`);

  map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });

  // 단계별 텍스트 안내 리스트 렌더링
  const stepsList = document.getElementById('routeStepsList');
  stepsList.innerHTML = guidePoints.map((g, i) => `
    <li class="step-item">
      <span class="step-index">${i + 1}</span>
      <span class="step-desc">${g.desc}</span>
    </li>
  `).join('');

  // 총 시간 및 거리
  const totalFeature = features[0];
  const totalDist = totalFeature.properties.totalDistance;
  const totalTime = Math.round(totalFeature.properties.totalTime / 60);

  document.getElementById('hudRemainDistance').textContent = `남은 거리: ${totalDist}m`;
  document.getElementById('hudRemainTime').textContent = `남은 시간: ${totalTime}분`;
  document.getElementById('hudInstruction').textContent = guidePoints[0]?.desc || '경로를 따라 이동하세요';
  document.getElementById('naviHud').style.display = 'flex';

  // 네비게이션 제어 버튼 활성화
  document.getElementById('startSimBtn').style.display = 'inline-block';
  document.getElementById('startNaviBtn').style.display = 'inline-block';
}

// ==========================================
// 4. 보행자 네비게이션 엔진 (이동 시 지난 길 실시간 삭제)
// ==========================================
function updateNavigationProgress(currentLat, currentLon) {
  if (remainingRouteCoords.length === 0) return;

  // 현재 위치 마커 표시 (블루 펄스 효과)
  if (!userMarker) {
    const pulseIcon = L.divIcon({
      className: 'user-marker-pulse',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    userMarker = L.marker([currentLat, currentLon], { icon: pulseIcon }).addTo(map);
  } else {
    userMarker.setLatLng([currentLat, currentLon]);
  }

  // 남은 경로 중 현재 위치와 가장 가까운 지점 찾기
  let closestIdx = 0;
  let minDist = Infinity;

  remainingRouteCoords.forEach((pt, idx) => {
    const dist = Math.hypot(pt[0] - currentLat, pt[1] - currentLon);
    if (dist < minDist) {
      minDist = dist;
      closestIdx = idx;
    }
  });

  // 지나온 길은 잘라내고, 남은 길만 업데이트 (실시간 경로 삭제 효과!)
  if (closestIdx > 0) {
    const passedPoints = remainingRouteCoords.slice(0, closestIdx + 1);
    remainingRouteCoords = remainingRouteCoords.slice(closestIdx);

    // 지나온 길에 누적 추가 후 남은 길 갱신
    passedPolyline.addLatLng([currentLat, currentLon]);
    routePolyline.setLatLngs(remainingRouteCoords);
  }

  // 실시간 턴 안내 갱신
  if (guidePoints.length > 0) {
    let nextGuide = guidePoints.find(g => {
      return Math.hypot(g.lat - currentLat, g.lon - currentLon) > 0.0001;
    }) || guidePoints[guidePoints.length - 1];

    document.getElementById('hudInstruction').textContent = nextGuide.desc;
  }

  // 남은 거리 대략 계산
  const remainDist = Math.round(remainingRouteCoords.length * 15);
  document.getElementById('hudRemainDistance').textContent = `남은 거리: ${remainDist}m`;

  if (remainingRouteCoords.length <= 2) {
    document.getElementById('hudInstruction').textContent = '🎉 목적지에 도착했습니다!';
    stopNavigation();
  }
}

// 모의 주행 (실내에서 네비 효과 테스트)
function startSimulation() {
  stopNavigation();
  if (fullRouteCoords.length === 0) return;

  remainingRouteCoords = [...fullRouteCoords];
  routePolyline.setLatLngs(remainingRouteCoords);
  passedPolyline.setLatLngs([]);

  let step = 0;
  const simBtn = document.getElementById('startSimBtn');
  simBtn.textContent = '모의 주행 중지';

  simInterval = setInterval(() => {
    if (step >= fullRouteCoords.length) {
      stopNavigation();
      return;
    }
    const [lat, lon] = fullRouteCoords[step];
    map.panTo([lat, lon], { animate: true, duration: 0.3 });
    updateNavigationProgress(lat, lon);
    step++;
  }, 450);
}

// 실시간 GPS 연동 네비
function startRealtimeNavigation() {
  stopNavigation();
  if (!navigator.geolocation) {
    alert('이 브라우저는 GPS를 지원하지 않습니다.');
    return;
  }

  const naviBtn = document.getElementById('startNaviBtn');
  naviBtn.textContent = '실시간 네비 중지';

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 17);
      updateNavigationProgress(latitude, longitude);
    },
    (err) => console.warn('GPS 수신 에러:', err),
    { enableHighAccuracy: true, maximumAge: 1000 }
  );
}

function stopNavigation() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
    document.getElementById('startSimBtn').textContent = '모의 주행 (테스트)';
  }
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    document.getElementById('startNaviBtn').textContent = '실시간 네비 시작';
  }
}

// ==========================================
// 5. 직접 촬영 / 사진첩 선택 & Gemini 분석
// ==========================================
const cameraInput = document.getElementById('cameraInput');
const galleryInput = document.getElementById('galleryInput');
const imagePreview = document.getElementById('imagePreview');
const previewContainer = document.getElementById('previewContainer');
const removeImgBtn = document.getElementById('removeImgBtn');

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
        imagePreview.src = dataUrl;
        previewContainer.style.display = 'flex';
      }
    };
    reader.readAsDataURL(file);
  });
});

removeImgBtn.addEventListener('click', () => {
  cameraInput.value = '';
  galleryInput.value = '';
  currentBase64Image = null;
  currentMimeType = null;
  imagePreview.src = '';
  previewContainer.style.display = 'none';
});

// 지도 클릭 시 민원 위치 지정 헬퍼
function setComplaintLocationFromCoords(lat, lon) {
  document.getElementById('complaintLat').value = lat;
  document.getElementById('complaintLon').value = lon;
  document.getElementById('complaintLocation').value = `지도 선택 위치 (${lat.toFixed(4)},${lon.toFixed(4)})`;

  if (complaintMarker) map.removeLayer(complaintMarker);
  complaintMarker = L.marker([lat, lon]).addTo(map).bindPopup('⚠️ 민원 접수 위치').openPopup();
}

// Gemini Vision AI 호출 (gemini-3.6-flash)
async function analyzeImageWithGemini(base64Image, mimeType, location, userNotes) {
  const prompt = `너는 지자체 스마트 도로 안전 관제 센터의 수석 AI 비전 판독관이다.
첨부된 도로 현장 사진을 시각적으로 정밀하게 분석하여 위험 요소와 파손 상태를 파악하고, 반드시 지정된 JSON 규격으로만 응답하라.
마크다운 태그(\`\`\`json)나 추가 해설 없이 순수 JSON 문자열만 출력해야 한다.

[제보 위치]: ${location}
[작성자 메모]: ${userNotes || '별도 기재 내용 없음'}

[판독 기준]:
1. 사진 속 도로 노면 상태, 파손 형태(포트홀, 크랙/균열, 침하, 도로결빙/블랙아이스, 낙석, 시설물 파손 등), 규모를 시각적으로 확인하라.
2. 보행자 낙상/발목 부상 위험 및 안전 통행 지침을 고려하여 위험 등급을 매겨라.

[출력 JSON 규격]:
{
  "riskLevel": "긴급" | "주의" | "보통",
  "category": "포트홀" | "도로균열" | "결빙" | "낙석" | "침하" | "시설파손" | "기타",
  "summary": "사진에서 확인된 1줄 핵심 요약",
  "visualFindings": "사진 속 위험 상태에 대한 구체적인 시각 분석 설명",
  "action": "지자체 도로보수과 담당자를 위한 긴급 조치 권고사항"
}`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image
            }
          }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    throw new Error(errorJson.error?.message || `HTTP ${response.status} 오류`);
  }

  const result = await response.json();
  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('AI 분석 결과를 수신하지 못했습니다.');

  return JSON.parse(rawText.replace(/```json/g, '').replace(/```/g, '').trim());
}

// 민원 제출 핸들러
async function handleComplaintSubmit(e) {
  e.preventDefault();

  if (!currentBase64Image) {
    alert('카메라 촬영 또는 사진첩에서 현장 사진을 선택해 주세요.');
    return;
  }

  const location = document.getElementById('complaintLocation').value.trim();
  const notes = document.getElementById('complaintNotes').value.trim();
  const submitBtn = document.getElementById('submitComplaintBtn');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Gemini 3.6 Flash가 현장 판독 중...';

  try {
    const analysis = await analyzeImageWithGemini(currentBase64Image, currentMimeType, location, notes);

    const complaintItem = {
      id: Date.now(),
      imageSrc: `data:${currentMimeType};base64,${currentBase64Image}`,
      location: location,
      riskLevel: analysis.riskLevel || '보통',
      category: analysis.category || '기타',
      summary: analysis.summary || '사진 판독 요약 없음',
      visualFindings: analysis.visualFindings || '시각 분석 정보 없음',
      action: analysis.action || '현장 점검 요망',
      createdAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    complaintsData.unshift(complaintItem);
    renderComplaints();

    // 폼 초기화
    removeImgBtn.click();
    document.getElementById('complaintNotes').value = '';
  } catch (error) {
    console.error('민원 AI 분석 실패:', error);
    alert(`AI 분석 오류: ${error.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '사진 AI 자동 분석 및 제보';
  }
}

function renderComplaints() {
  const countEl = document.getElementById('complaintCount');
  const listEl = document.getElementById('complaintsList');
  countEl.textContent = `${complaintsData.length}건`;

  if (complaintsData.length === 0) {
    listEl.innerHTML = '<div class="empty-state">접수된 민원이 없습니다.</div>';
    return;
  }

  listEl.innerHTML = complaintsData.map(item => {
    let badgeClass = 'badge-normal';
    if (item.riskLevel === '긴급') badgeClass = 'badge-danger';
    else if (item.riskLevel === '주의') badgeClass = 'badge-warning';

    return `
      <article class="complaint-card">
        <div class="card-top">
          <div class="card-meta">
            <span class="badge ${badgeClass}">${item.riskLevel}</span>
            <span class="badge badge-category">${item.category}</span>
            <span class="card-location">📍 ${item.location}</span>
          </div>
          <span class="card-time">${item.createdAt}</span>
        </div>
        
        <div class="card-body-layout">
          <img src="${item.imageSrc}" alt="현장 사진" class="card-thumbnail">
          <div class="card-details">
            <div class="card-summary">${item.summary}</div>
            <div class="card-vision-desc">🔍 시각 판독: ${item.visualFindings}</div>
            <div class="card-action">🚨 권고 조치: ${item.action}</div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// ==========================================
// 6. 초기화 및 이벤트 연결
// ==========================================
function init() {
  initMap();

  // 1) 출발지 POI 자동완성
  setupPoiAutocomplete(
    document.getElementById('startInput'),
    document.getElementById('startPoiList'),
    (lat, lon, name) => {
      document.getElementById('startLat').value = lat;
      document.getElementById('startLon').value = lon;
      if (startMarker) map.removeLayer(startMarker);
      startMarker = L.marker([lat, lon]).addTo(map).bindPopup(`출발: ${name}`).openPopup();
      map.panTo([lat, lon]);
    }
  );

  // 2) 도착지 POI 자동완성
  setupPoiAutocomplete(
    document.getElementById('endInput'),
    document.getElementById('endPoiList'),
    (lat, lon, name) => {
      document.getElementById('endLat').value = lat;
      document.getElementById('endLon').value = lon;
      if (endMarker) map.removeLayer(endMarker);
      endMarker = L.marker([lat, lon]).addTo(map).bindPopup(`도착: ${name}`).openPopup();
      map.panTo([lat, lon]);
    }
  );

  // 3) 민원 위치 POI 자동완성
  setupPoiAutocomplete(
    document.getElementById('complaintLocation'),
    document.getElementById('complaintPoiList'),
    (lat, lon, name) => {
      setComplaintLocationFromCoords(lat, lon);
      map.panTo([lat, lon]);
    }
  );

  // GPS로 출발지 설정 버튼
  document.getElementById('btnGpsStart').addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('GPS를 지원하지 않는 브라우저입니다.');
      return;
    }
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      document.getElementById('startInput').value = '현재 내 GPS 위치';
      document.getElementById('startLat').value = lat;
      document.getElementById('startLon').value = lon;
      if (startMarker) map.removeLayer(startMarker);
      startMarker = L.marker([lat, lon]).addTo(map).bindPopup('내 현재 위치').openPopup();
      map.setView([lat, lon], 16);
    }, (err) => alert(`GPS 오류: ${err.message}`));
  });

  // 버튼 이벤트 연결
  document.getElementById('routeForm').addEventListener('submit', searchPedestrianRoute);
  document.getElementById('startSimBtn').addEventListener('click', () => {
    if (simInterval) stopNavigation();
    else startSimulation();
  });
  document.getElementById('startNaviBtn').addEventListener('click', () => {
    if (watchId) stopNavigation();
    else startRealtimeNavigation();
  });
  document.getElementById('complaintForm').addEventListener('submit', handleComplaintSubmit);
}

document.addEventListener('DOMContentLoaded', init);
