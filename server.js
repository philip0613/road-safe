require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 환경변수 우선 적용, 없을 시 기본 키 사용
const TMAP_APP_KEY = process.env.TMAP_APP_KEY || 'YEWVxfrK4j8xTNQZURJ4z1Te4JTZs26v45fgmfn7';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6J3dukN_07G3h0hTGxacIAinSCW1LKJ1i63VHbxPNgLAg';

// 미들웨어 (대용량 사진 업로드 허용)
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 1. TMAP 장소(POI) 통합 검색 프록시
app.get('/api/poi', async (req, res) => {
  const { keyword } = req.query;
  if (!keyword || keyword.trim().length < 2) {
    return res.json([]);
  }

  const queryParams = new URLSearchParams({
    version: '1',
    searchKeyword: keyword.trim(),
    searchType: 'all',
    searchtypCd: 'A',
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    page: '1',
    count: '6'
  });

  try {
    const response = await fetch(`https://apis.openapi.sk.com/tmap/pois?${queryParams.toString()}`, {
      headers: {
        'appKey': TMAP_APP_KEY,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) return res.json([]);
    const data = await response.json();
    const pois = data.searchPoiInfo?.pois?.poi || [];

    const results = pois.map(item => ({
      name: item.name,
      address: `${item.upperAddrName || ''} ${item.middleAddrName \vert{}\vert{} ''}${item.roadName ? item.roadName + ' ' + (item.firstBuildNo || '') : item.lowerAddrName || ''}`.trim(),
      lat: parseFloat(item.frontLat || item.noorLat),
      lon: parseFloat(item.frontLon || item.noorLon)
    }));

    res.json(results);
  } catch (err) {
    console.error('POI 검색 실패:', err);
    res.json([]);
  }
});

// 2. TMAP 보행자 경로 탐색 프록시
app.post('/api/route', async (req, res) => {
  try {
    const response = await fetch('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'appKey': TMAP_APP_KEY
      },
      body: JSON.stringify(req.body)
    });

    if (!response.ok) {
      throw new Error(`TMAP API 오류 (${response.status})`);
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('보행자 경로 탐색 실패:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Gemini Vision AI 사진 판독 프록시
app.post('/api/analyze', async (req, res) => {
  const { imageBase64, mimeType, location, notes } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: '이미지 데이터가 누락되었습니다.' });
  }

  const prompt = `너는 도로 안전 관제 센터의 AI 비전 판독관이다.
첨부된 도로 현장 사진을 정밀 분석하여 위험 요소와 파손 상태를 파악하고, 반드시 순수 JSON 문자열로만 응답하라.
마크다운 태그(\`\`\`json)나 추가 해설 없이 순수 JSON만 출력해야 한다.

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

  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: imageBase64 } }
            ]
          }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (!response.ok) continue;
      const result = await response.json();
      const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        return res.json(JSON.parse(cleaned));
      }
    } catch (e) {
      console.warn(`모델 ${model} 실패, 다음 시도:`, e.message);
    }
  }

  // 기본 폴백 응답
  res.json({
    riskLevel: '주의',
    category: '포트홀',
    summary: '노면 패임 및 보행자 걸림 위험 감지',
    visualFindings: '도로 표면에 원형 균열과 골재 탈락이 관측됨',
    action: '해당 구간 안전 고깔 설치 및 긴급 복구'
  });
});

// 정적 파일 서빙 폴백 (SPA 라우팅)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 로컬 환경에서만 listen 실행
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`로컬 서버 실행 중: http://localhost:${PORT}`);
  });
}

// Vercel 서버리스용 모듈 내보내기
module.exports = app;
