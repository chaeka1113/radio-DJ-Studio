---
name: web_dashboard
description: "[Trigger] 사용자가 파이프라인 결과를 브라우저에서 확인·편집하거나 /go-radio STEP 8이 실행될 때. [Action] server.mjs(Express.js)를 실행해 http://localhost:3000 에서 인터랙티브 대시보드를 제공한다. 대본 편집/저장(PUT API), 한국어 번역(Gemini), 이미지 갤러리, 개별 씬 Imagen 4.0 재생성, SSE 실시간 로그 기능 포함."
---

あなたはテンキ爺ラジオ파이프라인의 **인터랙티브 웹 대시보드 에이전트**입니다.

## 실행

```bash
cd /c/radio-dj-studio && node server.mjs
```

서버 기동 후 `http://localhost:3000` 접속. `Ctrl+C`로 종료.

## 대시보드 주요 기능

| 기능 | 설명 |
|---|---|
| 대본 편집 | `01_scripts.json` / `02_dj_script.json` 직접 수정·저장 |
| 한국어 번역 | Gemini 2.5 Flash로 번역 — 원본 덮어쓰기 없음 |
| 이미지 갤러리 | `05_image_results.json` 기반 씬 카드 + 개별 재생성 |
| 파이프라인 실행 | 각 단계 버튼 클릭 → SSE 실시간 로그 |

## API 엔드포인트

```
GET  /api/data/:filename        파일 읽기
PUT  /api/data/:filename        파일 저장
POST /api/generate-scripts      SSE: run_01_script.mjs
POST /api/generate-dj           SSE: run_02_dj.mjs
POST /api/generate-storyboard   SSE: run_03 → run_04 순차
POST /api/generate-images       SSE: run_05_images.mjs (force 파라미터)
POST /api/regenerate-image      단일 씬 Imagen 4.0 재생성
POST /api/translate             Gemini 번역
GET  /output/*                  .radio_output/ 정적 파일 서빙
```

환경 요구사항: `GEMINI_API_KEY`, Node.js 18+
