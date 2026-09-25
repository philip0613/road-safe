// ==========================================
// API 키 설정
// ==========================================
const TMAP_APP_KEY = 'YEWVxfrK4j8xTNQZURJ4z1Te4JTZs26v45fgmfn7';
const GEMINI_API_KEY = 'AQ.Ab8RN6J3dukN_07G3h0hTGxacIAinSCW1LKJ1i63VHbxPNgLAg';

// 모델명 지정 (gemini-3.6-flash)
const GEMINI_MODEL = 'gemini-3.6-flash';

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
const complaintImage = document.getElementById('complaintImage');
const previewContainer = document.getElementById('previewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeImgBtn = document.getElementById('removeImgBtn');
const complaintLocation = document.getElementById('complaintLocation');
const complaintNotes = document.getElementById('complaintNotes');
const complaintsList = document.getElementById('complaintsList');
const complaintCount = document.getElementById('complaintCount');

let currentBase64Image = null;
let currentMimeType = null;
let complaintsData = [];

// ==========================================
// 이미지 업로드 및 Base64 변환 핸들러
// ==========================================
complaintImage.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) {
    clearImagePreview();
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const mimeMatch = dataUrl.match(/^data:(.*?);base64,(.*)$/);
    if (mimeMatch) {
      currentMimeType = mimeMatch[1];
      currentBase64Image = mimeMatch[2];
      imagePreview.src = dataUrl;
      previewContainer.style.display = 'flex';
    }
  };
  reader.readAsDataURL(file);
});

removeImgBtn.addEventListener('click', () => {
  clearImagePreview();
});

function clearImagePreview() {
  complaintImage.value = '';
  currentBase64Image = null;
  currentMimeType = null;
  imagePreview.src = '';
  previewContainer.style.display = 'none';
}

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
    mapLoader.textContent = '지도를 불러오지 못했습니다.';
  };
  staticMapImg.src = url;
}

// ==========================================
// Tmap 보행자 경로 탐색
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
      throw new Error(`Tmap 응답 오류 (${response.status})`);
    }

    const data = await response.json();
    renderRouteResult(data);
  } catch (error) {
    console.error('경로 탐색 오류:', error);
    routeStepsList.innerHTML = `<li class="empty-state" style="color: #ef4444;">탐색 실패: ${error.message}</li>`;
  } finally {
    searchRouteBtn.disabled = false;
    searchRouteBtn.textContent = '보행자 안전 경로 탐색';
  }
}

function renderRouteResult(data) {
  if (!data || !data.features || data.features.length === 0) {
    routeStepsList.innerHTML = '<li class="empty-state">탐색된 경로가 없습니다.</li>';
    return;
  }

  const totalFeature = data.features[0];
  const totalDistance = totalFeature.properties.totalDistance;
  const totalTime = totalFeature.properties.totalTime;

  summaryDistance.textContent = totalDistance >= 1000 
    ? (totalDistance / 1000).toFixed(2) + ' km' 
    : totalDistance + ' m';
  summaryTime.textContent = `${Math.round(totalTime / 60)}분`;
  routeSummary.style.display = 'grid';

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
// Gemini 3.6 Flash Vision AI 분석
// ==========================================
async function analyzeImageWithGemini(base64Image, mimeType, location, userNotes) {
  const prompt = `너는 지자체 스마트 도로 안전 관제 센터의 수석 AI 비전 판독관이다.
첨부된 도로 현장 사진을 시각적으로 정밀하게 분석하여 위험 요소와 파손 상태를 파악하고, 반드시 지정된 JSON 규격으로만 응답하라.
마크다운 태그(\`\`\`json)나 추가 해설 없이 순수 JSON 문자열만 출력해야 한다.

[제보 위치]: ${location}
[작성자 메모]: ${userNotes || '별도 기재 내용 없음'}

[판독 기준]:
1. 사진 속 도로 노면 상태, 파손 형태(포트홀, 크랙/균열, 도로침하, 결빙/블랙아이스, 낙석, 시설물 파손 등), 규모를 시각적으로 확인하라.
2. 보행자 보행 안전(낙상, 발목 부상) 및 통행 차량 안전을 종합하여 위험도를 산정하라.

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
    headers: {
      'Content-Type': 'application/json'
    },
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

  // 구글 API 응답 에러 확인
  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    const message = errorJson.error?.message || `HTTP ${response.status} 오류`;
    throw new Error(message);
  }

  const result = await response.json();
  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini로부터 분석 응답을 수신하지 못했습니다.');
  }

  const cleanedJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleanedJson);
}

// ==========================================
// 민원 제출 핸들러
// ==========================================
async function handleComplaintSubmit(e) {
  e.preventDefault();

  if (!currentBase64Image) {
    alert('도로 현장 사진을 첨부해야 AI 정밀 분석이 가능합니다.');
    return;
  }

  const location = complaintLocation.value.trim();
  const notes = complaintNotes.value.trim();

  submitComplaintBtn.disabled = true;
  submitComplaintBtn.textContent = 'Vision AI가 현장 사진 판독 중...';

  try {
    const analysis = await analyzeImageWithGemini(currentBase64Image, currentMimeType, location, notes);

    const complaintItem = {
      id: Date.now(),
      imageSrc: `data:${currentMimeType};base64,${currentBase64Image}`,
      location: location,
      notes: notes,
      riskLevel: analysis.riskLevel || '보통',
      category: analysis.category || '기타',
      summary: analysis.summary || '사진 판독 요약 없음',
      visualFindings: analysis.visualFindings || '시각 분석 정보 없음',
      action: analysis.action || '현장 점검 요망',
      createdAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    complaintsData.unshift(complaintItem);
    renderComplaints();

    clearImagePreview();
    complaintNotes.value = '';
  } catch (error) {
    console.error('Vision AI 분석 실패:', error);
    alert(`AI 사진 판독 실패: ${error.message}`);
  } finally {
    submitComplaintBtn.disabled = false;
    submitComplaintBtn.textContent = '사진 AI 자동 분석 및 제보';
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
        
        <div class="card-body-layout">
          <img src="${item.imageSrc}" alt="현장 사진" class="card-thumbnail">
          <div class="card-details">
            <div class="card-summary">${item.summary}</div>
            <div class="card-vision-desc">🔍 판독 상세: ${item.visualFindings}</div>
            <div class="card-action">🚨 권고 조치: ${item.action}</div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// ==========================================
// 초기화
// ==========================================
function init() {
  routeForm.addEventListener('submit', searchPedestrianRoute);
  complaintForm.addEventListener('submit', handleComplaintSubmit);

  // 기본 지도 로드 (서울역 기준)
  updateStaticMap(37.5547, 126.9706);
}

document.addEventListener('DOMContentLoaded', init);
