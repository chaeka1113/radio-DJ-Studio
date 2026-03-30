---
name: auto-radio
description: "[Trigger] 사용자가 /auto-radio [주제1] [주제2] [주제3]을 실행할 때. [Action] .env 환경 검증 후 대본(01)→DJ멘트(02)→캐스팅+스토리보드(03+04)→이미지(05)→TTS합본(07) 전체 파이프라인을 순서대로 실행하고 결과를 .radio_output/에 저장한다. 완료 후 파일 목록 및 통계를 보고."
---

# /auto-radio

Google AI Studio (Gemini + Imagen 3 + Veo 2) 기반 구닥다리 로봇 DJ 라디오 유튜브 영상 자동화 팩토리를 실행한다.

## 사용법
```
/auto-radio [주제1] [주제2] [주제3]
```

## 예시
```
/auto-radio 失恋 定年退職 故郷への帰省
/auto-radio 첫사랑 은퇴 어머니의 손편지
```

---

## 실행 파이프라인

전역 규칙 `.claude/skills/radio_api_rules.md` 를 모든 단계에 적용한다.

---

### [STEP 0] 초기화 및 환경 검증

아래 체크를 순서대로 실행하라:

```bash
# 1. .env 파일 존재 확인
ls /c/radio-dj-studio/.env 2>/dev/null || echo "MISSING"
```

**.env 파일이 없거나 API 키가 미입력 상태면**:
```
⚠️ 시작 전 설정 필요

1. .env 파일 생성:
   cp /c/radio-dj-studio/.env.example /c/radio-dj-studio/.env

2. .env 파일을 열고 API 키 입력:
   GEMINI_API_KEY=여기에_Google_AI_Studio_키_입력
   ELEVENLABS_API_KEY=여기에_ElevenLabs_키_입력 (선택)

3. API 키 발급 위치:
   - Google AI Studio: https://aistudio.google.com/apikey
   - ElevenLabs: https://elevenlabs.io/app/settings/api-keys

4. 설정 완료 후 다시 /auto-radio 실행
```

**.env 확인 후 계속**:
```bash
# 출력 폴더 생성
mkdir -p /c/radio-dj-studio/.radio_output/images
mkdir -p /c/radio-dj-studio/.radio_output/videos
mkdir -p /c/radio-dj-studio/.radio_output/audio

# API 키 로드 확인
export GEMINI_API_KEY=$(grep "^GEMINI_API_KEY" /c/radio-dj-studio/.env | cut -d= -f2)
export ELEVENLABS_API_KEY=$(grep "^ELEVENLABS_API_KEY" /c/radio-dj-studio/.env | cut -d= -f2)
echo "GEMINI_API_KEY 설정: ${GEMINI_API_KEY:0:10}..."
```

---

### [STEP 1] 대본 생성 (01_script_writer)
**에이전트**: `.claude/agents/01_script_writer.md`

아래 Node.js 스크립트를 `.radio_output/run_01_script.mjs` 로 작성하고 실행하라. (에이전트 파일의 스크립트 내용 사용)

입력 주제: `$ARGUMENTS` (공백 또는 쉼표 구분, 3개)

```bash
cd /c/radio-dj-studio && node .radio_output/run_01_script.mjs [주제1] [주제2] [주제3]
```

완료 조건: `.radio_output/01_scripts.json` 존재

---

### [STEP 2] DJ 멘트 추가 (02_dj_persona)
**에이전트**: `.claude/agents/02_dj_persona.md`

`.radio_output/run_02_dj.mjs` 작성 후 실행.

```bash
cd /c/radio-dj-studio && node .radio_output/run_02_dj.mjs
```

완료 조건: `.radio_output/02_dj_script.json` 존재

---

### [STEP 3] 캐릭터 프롬프트 생성 (03_casting_director)
**에이전트**: `.claude/agents/03_casting_director.md`

`.radio_output/run_03_casting.mjs` 작성 후 실행.

```bash
cd /c/radio-dj-studio && node .radio_output/run_03_casting.mjs
```

완료 조건: `.radio_output/03_character_prompts.json` 존재

---

### [STEP 4] 스토리보드 생성 (04_storyboard_director)
**에이전트**: `.claude/agents/04_storyboard_director.md`

`.radio_output/run_04_storyboard.mjs` 작성 후 실행.

```bash
cd /c/radio-dj-studio && node .radio_output/run_04_storyboard.mjs
```

완료 조건: `.radio_output/04_storyboard.json` 존재

---

### [STEP 5] 이미지 생성 — Imagen 3 실제 API 호출 (05_art_director)
**에이전트**: `.claude/agents/05_art_director.md`

> ⚠️ 이 단계부터 실제 API 크레딧이 소모됩니다.
> 씬 수에 따라 수분~수십분 소요. 무료 티어: 10 RPM / 1500 RPD

`.radio_output/run_05_images.mjs` 작성 후 실행.

```bash
cd /c/radio-dj-studio && node .radio_output/run_05_images.mjs
```

완료 조건: `.radio_output/05_image_results.json` 존재, `.radio_output/images/*.png` 파일 생성

---

### [STEP 6] 오디오 스크립트 생성 (07_audio_director)
**에이전트**: `.claude/agents/07_audio_director.md`

`.radio_output/run_07_audio.mjs` 작성 후 실행.

```bash
cd /c/radio-dj-studio && node .radio_output/run_07_audio.mjs
```

완료 조건: `.radio_output/07_audio_script.json`, `.radio_output/07_EP*_plain_script.txt` 존재
(ELEVENLABS_API_KEY 있으면 `.radio_output/audio/*.mp3` 도 생성)

---

### [STEP 7] 완료 보고

모든 파일 생성 완료 후 아래 형식으로 보고하라:

```
✅ /auto-radio 파이프라인 완료!

📁 생성된 파일 목록:
  .radio_output/
  ├── 01_scripts.json          ← 일본어 사연 대본 3편
  ├── 02_dj_script.json        ← DJ テンキ爺 멘트 추가
  ├── 03_character_prompts.json ← 캐릭터 이미지 프롬프트
  ├── 04_storyboard.json       ← 씬 분해 결과
  ├── 05_image_results.json    ← 이미지 생성 결과
  ├── 07_audio_script.json     ← TTS 스크립트
  ├── 07_EP1_plain_script.txt  ← ElevenLabs 직접 붙여넣기용
  ├── images/                  ← PNG 이미지 파일들
  └── audio/                   ← MP3 오디오 파일들 (ElevenLabs 키 있을 때)

📊 생성 통계:
  이미지: X개 성공 / Y개 실패

🎬 다음 단계:
  1. node server.mjs → http://localhost:3000 대시보드에서 결과 확인 및 편집
  2. audio/*.mp3 (또는 plain_script.txt로 ElevenLabs 웹 생성) 오디오 합성
  3. YouTube 업로드
```
