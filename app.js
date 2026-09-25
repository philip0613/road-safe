// ==========================================
// API 키 설정
// ==========================================
const TMAP_APP_KEY = 'YEWVxfrK4j8xTNQZURJ4z1Te4JTZs26v45fgmfn7';
const GEMINI_API_KEY = 'AQ.Ab8RN6J3dukN_07G3h0hTGxacIAinSCW1LKJ1i63VHbxPNgLAg';

// ==========================================
// DOM 요소 참조
// ==========================================
const routeForm = document.getElementById('routeForm');
const searchRouteBtn = document.getElementById('searchRouteBtn');
const staticMapImg = document.getElementById('staticMapImg');
const mapLoader = document.getElementById('mapLoader');
const routeSummary = document.getElementById('routeSummary');
const summaryDistance = document.getElementById('summaryDistance');
const summaryTime = document.getElementById('summaryTime');
const routeStepsList = document.getElementById('routeStepsList');

const complaintForm = document.getElementById('complaintForm');
const submitComplaintBtn = document.getElementById('submitComplaintBtn');
const complaintLocation = document.getElementById('complaintLocation');
const complaintContent = document.getElementById('complaintContent');
const complaintsList = document.getElementById('complaintsList');
const complaintCount = document.getElementById('complaintCount');

let complaintsData = [];

// ==========================================
// Tmap 정적 지도 업데이트
// ==========================================
function updateStaticMap(lat, lon) {
  mapLoader.style.display = 'flex';
  const url = `https://apis.openapi.sk.com/tmap/staticMap?version=1&coordType=WGS84GEO&width=600&height=400&zoom=15&format=PNG&longitude=${lon}&latitude=${lat}&appKey=${TMAP_APP_KEY}`;
  
  staticMapImg.onload = () => {
    mapLoader.style.display = 'none';
  };
  staticMapImg.onerror = () => {
    mapLoader.textContent = '지도 이미지를 불러오지 못했습니다.';
  };
  staticMapImg.src = url;
}

// ==========================================
// Tmap 보행자 경로 탐색 API 호출
// ==========================================
async function searchPedestrianRoute(e) {
  e.preventDefault();

  const startName = document.getElementById('startName').value.trim();
  const endName = document.getElementById('endName').value.trim();
  const startLat = parseFloat(document.getElementById('startLat').value);
  const startLon = parseFloat(document.getElementById('startLon').value);
  const endLat = parseFloat(document.getElementById('endLat').value);
  const endLon = parseFloat(document.getElementById('endLon').value);

  searchRouteBtn.disabled = true;
  searchRouteBtn.textContent = '경로 탐색 중...';
  routeStepsList.innerHTML = '<li class="empty-state">경로 정보를 분석하고 있습니다...</li>';

  // 출발지 기준으로 정적 지도 동기화
  updateStaticMap(startLat, startLon);

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

    if (!response.ok) {
      throw new Error(`Tmap API 오류: ${response.status}`);
    }

    const data = await response.json();
    renderRouteResult(data);
  } catch (error) {
    console.error('보행자 경로 탐색 실패:', error);
    routeStepsList.innerHTML = `<li class="empty-state" style="color: #ef4444;">탐색 실패: ${error.message}</li>`;
  } finally {
    searchRouteBtn.disabled = false;
    searchRouteBtn.textContent = '보행자 안전 경로 탐색';
  }
}

// ==========================================
// 보행자 경로 탐색 결과 렌더링
// ==========================================
function renderRouteResult(data) {
  if (!data || !data.features || data.features.length === 0) {
    routeStepsList.innerHTML = '<li class="empty-state">검색된 경로가 없습니다.</li>';
    return;
  }

  // 총 거리 및 소요 시간 계산
  const totalFeature = data.features[0];
  const totalDistance = totalFeature.properties.totalDistance; // 미터
  const totalTime = totalFeature.properties.totalTime; // 초

  const distanceText = totalDistance >= 1000 
    ? (totalDistance / 1000).toFixed(2) + ' km' 
    : totalDistance + ' m';
  const minutes = Math.round(totalTime / 60);

  summaryDistance.textContent = distanceText;
  summaryTime.textContent = `${minutes}분`;
  routeSummary.style.display = 'grid';

  // 경로 안내 상세 단계 필터링
  const steps = data.features
    .filter(f => f.properties && f.properties.description)
    .map(f => f.properties.description);

  if (steps.length === 0) {
    routeStepsList.innerHTML = '<li class="empty-state">안내 구간 정보가 없습니다.</li>';
    return;
  }

  routeStepsList.innerHTML = steps.map((step, idx) => `
    <li class="step-item">
      <span class="step-index">${idx + 1}</span>
      <span class="step-desc">${step}</span>
    </li>
  `).join('');
}

// ==========================================
// Gemini API 민원 AI 분석
// ==========================================
async function analyzeComplaintWithGemini(location, content) {
  const prompt = `너는 지자체 도로 안전 관제 센터의 AI 분석관이다.
다음 접수된 도로 안전 민원을 정밀 분석하여 반드시 지정된 JSON 규격으로만 응답하라.
마크다운 태그(\`\`\`json)나 추가 설명 없이 순수 JSON 문자열만 출력해야 한다.

[민원 발생 위치]: ${location}
[민원 내용]: ${content}

[출력 JSON 필드 규격]:
{
  "riskLevel": "긴급" | "주의" | "보통",
  "category": "포트홀" | "결빙" | "낙석" | "사고" | "도로파손" | "기타",
  "summary": "1줄 핵심 요약",
  "action": "지자체 담당 부서의 권장 긴급 조치 사항"
}`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API 오류: ${response.status}`);
  }

  const result = await response.json();
  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini로부터 분석 응답을 수신하지 못했습니다.');
  }

  // 혹시 감싸져 있을 수 있는 마크다운 블록 제거 후 파싱
  const cleanedJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleanedJson);
}

// ==========================================
// 민원 제출 핸들러
// ==========================================
async function handleComplaintSubmit(e) {
  e.preventDefault();

  const location = complaintLocation.value.trim();
  const content = complaintContent.value.trim();

  if (!location || !content) return;

  submitComplaintBtn.disabled = true;
  submitComplaintBtn.textContent = 'AI 분석 진행 중...';

  try {
    const analysis = await analyzeComplaintWithGemini(location, content);

    const complaintItem = {
      id: Date.now(),
      location: location,
      content: content,
      riskLevel: analysis.riskLevel || '보통',
      category: analysis.category || '기타',
      summary: analysis.summary || '민원 요약 없음',
      action: analysis.action || '현장 실사 필요',
      createdAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    complaintsData.unshift(complaintItem);
    renderComplaints();
    
    // 내용 초기화
    complaintContent.value = '';
  } catch (error) {
    console.error('민원 AI 분석 실패:', error);
    alert(`AI 분석 중 오류가 발생했습니다: ${error.message}`);
  } finally {
    submitComplaintBtn.disabled = false;
    submitComplaintBtn.textContent = 'AI 분석 및 제보';
  }
}

// ==========================================
// 민원 카드 렌더링
// ==========================================
function renderComplaints() {
  complaintCount.textContent = `${complaintsData.length}건`;

  if (complaintsData.length === 0) {
    complaintsList.innerHTML = '<div class="empty-state">접수된 민원이 없습니다.</div>';
    return;
  }

  complaintsList.innerHTML = complaintsData.map(item => {
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
        <div class="card-summary">${item.summary}</div>
        <div class="card-original">제보 내용: ${item.content}</div>
        <div class="card-action">조치 권고: ${item.action}</div>
      </article>
    `;
  }).join('');
}

// ==========================================
// 초기화 및 이벤트 리스너 등록
// ==========================================
function init() {
  routeForm.addEventListener('submit', searchPedestrianRoute);
  complaintForm.addEventListener('submit', handleComplaintSubmit);

  // 기본 지도 로드 (서울역 기준)
  updateStaticMap(37.5547, 126.9706);
}

document.addEventListener('DOMContentLoaded', init);
