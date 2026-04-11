---
name: go-radio
description: "[Trigger] 사용자가 /go-radio (또는 /go-radio [주제1] [주제2] [주제3], --qa 플래그 포함)을 실행할 때. [Action] 주제 미입력 시 Yahoo Japan+NHK RSS로 트렌드를 자동 수집한다. --qa 플래그를 파싱하고 EP_ID(EP_YYYYMMDD_HHMM) 생성 후 트렌드수집(00, 자동모드)→대본(01)→DJ멘트(02)→캐스팅(03)→[즉문즉답(08, --qa시만)]→스토리보드(04)→이미지(05)→TTS합본(07)→웹대시보드(서버 실행) 전체 파이프라인을 순서대로 실행한다. 결과를 .output/{EP_ID}/에 격리 저장하고 http://localhost:3000 대시보드를 제공."
---

# /go-radio

テンキ爺ラジオ 유튜브 영상 자동화 파이프라인.
주제를 입력하거나 생략하면 Yahoo Japan + NHK RSS 트렌드를 자동 수집한다.
`--qa` 플래그로 즉문즉답 코너 추가.

## 사용법
```
/go-radio                              ← 트렌드 자동 수집 (주제 생략)
/go-radio [주제1] [주제2] [주제3]       ← 주제 직접 입력
/go-radio [주제1] [주제2] [주제3] --qa ← QA 코너 추가
```

## 예시
```
/go-radio
/go-radio 健康 老後資金 熟年離婚
/go-radio 健康 老後資金 熟年離婚 --qa
```

---

## 실행 전 체크리스트

```bash
# .env 확인
ls /c/radio-dj-studio/.env 2>/dev/null || echo "❌ 없음 → cp .env.example .env 후 API 키 입력"

# 폴더 준비
mkdir -p /c/radio-dj-studio/.radio_output/{images,videos,audio}

# API 키 로드
export GEMINI_API_KEY=$(grep "^GEMINI_API_KEY" /c/radio-dj-studio/.env | cut -d= -f2)
echo "KEY: ${GEMINI_API_KEY:0:10}..."
```

---

## STEP 0 — EP_ID 생성 + 플래그 파싱 + 주제 결정

**[0-A] EP_ID 생성** (파이프라인 최초 1회):
```bash
EP_ID="EP_$(date +%Y%m%d_%H%M)"
echo "📌 에피소드 ID: $EP_ID"
mkdir -p /c/radio-dj-studio/.output/$EP_ID/{images,audio,videos,capcut}
```
이후 모든 단계는 `EP_ID` 환경변수를 참조하거나 `--ep-id $EP_ID` 인수로 전달한다.

**[0-B] 플래그 파싱:**
`$ARGUMENTS`에서 `--qa` 감지:
- 포함 → `QA_MODE=true`, 주제는 나머지 인수
- 미포함 → `QA_MODE=false`

**[0-C] 주제 결정 (2가지 경로):**

**A) 주제 직접 입력** (`$ARGUMENTS`에 주제가 3개 이상 있을 때):
- `$ARGUMENTS`의 비-플래그 인수 3개를 주제로 사용

**B) 트렌드 자동 수집** (`$ARGUMENTS`가 비어있거나 주제가 3개 미만일 때):
```bash
cd /c/radio-dj-studio && node .radio_output/run_00_trend_fetcher.mjs
```
완료 조건: `.radio_output/00_trends.json` 생성 및 `topics` 배열 3개 확인.
생성된 주제를 이후 단계에서 사용한다.

---

## STEP 1 — 대본 생성 (800~1,000文字/편)
**에이전트:** `.claude/agents/01_script_writer.md`

```bash
cd /c/radio-dj-studio && node .radio_output/run_01_script.mjs "[주제1]" "[주제2]" "[주제3]"
```
완료 조건: `.radio_output/01_scripts.json`

---

## STEP 2 — テンキ爺 방송 전체 멘트 (오프닝/리액션/트랜지션/엔딩)
**에이전트:** `.claude/agents/02_dj_persona.md`

```bash
cd /c/radio-dj-studio && node .radio_output/run_02_dj.mjs
```
완료 조건: `.radio_output/02_dj_script.json`

---

## STEP 3 — 캐릭터 고정 시드 생성
**에이전트:** `.claude/agents/03_casting_director.md`

```bash
cd /c/radio-dj-studio && node .radio_output/run_03_casting.mjs
```
완료 조건: `.radio_output/03_character_prompts.json`

---

## STEP 4 — [조건부] 즉문즉답 대본 생성 (QA_MODE=true만)
**에이전트:** `.claude/agents/08_qa_segment.md`

`--qa` 플래그가 있을 때만 실행:
```bash
cd /c/radio-dj-studio && node .radio_output/run_08_qa.mjs
```
완료 조건: `.radio_output/08_qa_script.json`

`--qa` 없으면 건너뜀. (STEP 5의 스토리보드가 08_qa_script.json 유무를 자동 감지함)

---

## STEP 5 — 스토리보드 생성 (캐릭터 시드 삽입 + QA DJ_SHOT 자동 추가)
**에이전트:** `.claude/agents/04_storyboard_director.md`

```bash
cd /c/radio-dj-studio && node .radio_output/run_04_storyboard.mjs
```
- `08_qa_script.json` 감지 시 EP2 직후 DJ_SHOT 5개 자동 삽입
- 출력: flat `scenes` 배열

완료 조건: `.radio_output/04_storyboard.json`

---

## STEP 6 — 이미지 생성 (Imagen 4.0 전용, 폴백 없음)
**에이전트:** `.claude/agents/05_art_director.md`

> ⚠️ 실제 API 크레딧 소모. 씬 수 × 7초 소요.
> 429 에러 → 지수 백오프(30s/60s/120s) 후 Imagen 4.0으로만 재시도.

```bash
cd /c/radio-dj-studio && node .radio_output/run_05_images.mjs
```
완료 조건: `.radio_output/05_image_results.json`, `images/*.png`

---

## STEP 7 — TTS 합본 생성
**에이전트:** `.claude/agents/07_audio_director.md`

```bash
cd /c/radio-dj-studio && node .radio_output/run_07_audio.mjs
```
- `08_qa_script.json` 존재 시 EP2 다음에 즉문즉답 코너 자동 삽입
- 오염 텍스트 자동 검수·제거

완료 조건: `.radio_output/final_script_for_tts.txt`

---

## STEP 8 — Web 대시보드 실행

```bash
cd /c/radio-dj-studio && node server.mjs
```

- Express 서버 포트 3000에서 실행
- `http://localhost:3000` 에서 인터랙티브 대시보드 오픈
- 대본 편집·번역, 이미지 갤러리, 개별 씬 재생성 지원

---

## STEP 9 — 완료 보고

```
✅ /go-radio 파이프라인 완료!
QA 모드: [ON/OFF]

📁 .radio_output/
├── 01_scripts.json            ← 대본 3편 (800~1000文字)
├── 02_dj_script.json          ← 오프닝/리액션/트랜지션/엔딩
├── 03_character_prompts.json  ← 캐릭터 고정 시드
├── 04_storyboard.json         ← 씬 flat 배열 (시드 삽입 완료)
├── 08_qa_script.json          ← 즉문즉답 5문답 (--qa 시)
├── 05_image_results.json      ← 이미지 결과
├── final_script_for_tts.txt   ← ElevenLabs 합본
├── images/*.png
└── audio/*.mp3

🌐 대시보드: http://localhost:3000
```
