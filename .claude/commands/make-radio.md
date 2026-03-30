---
name: make-radio
description: "[Trigger] 사용자가 /make-radio [주제1] [주제2] [주제3]을 실행할 때. [Action] radio_rules.md 전역 규칙을 적용해 대본(01)→DJ멘트(02)→캐릭터프롬프트(03)→스토리보드(04)→이미지페이로드(05)→오디오스크립트(07) 7단계 파이프라인을 순서대로 실행한다. 각 단계의 출력 파일 존재 확인 후 완료 보고."
---

# /make-radio

ガラクタロボDJラジオ YouTube 롱폼 영상 자동화 파이프라인을 실행한다.

## 사용법
```
/make-radio [주제1] [주제2] [주제3]
```

## 예시
```
/make-radio 失恋 定年退職 故郷への帰省
```

---

## 실행 지시서

아래 7단계를 **순서대로** 실행하라. 각 단계는 반드시 이전 단계의 출력 파일이 생성된 후 시작한다.

`.claude/skills/radio_rules.md` 의 전역 규칙을 파이프라인 전체에 적용한다.

---

### STEP 0: 출력 폴더 준비
```
.radio_output/ 폴더가 없으면 생성한다.
기존 파일이 있으면 덮어쓰기 전에 사용자에게 확인을 요청한다.
```

---

### STEP 1: 대본 작성 (script_writer)
**에이전트**: `.claude/agents/01_script_writer.md`

**입력**: 사용자가 제공한 주제3개: `$ARGUMENTS`

**지시**:
> 위 에이전트의 시스템 프롬프트와 전역 규칙(`radio_rules.md`)에 따라, 입력된 3개의 주제로 각각 400~600자 일본어 사연 대본을 작성하라. 결과를 `.radio_output/01_scripts.json` 으로 저장하라.

**완료 조건**: `.radio_output/01_scripts.json` 파일 존재 확인

---

### STEP 2: DJ 페르소나 멘트 추가 (dj_persona)
**에이전트**: `.claude/agents/02_dj_persona.md`

**입력**: `.radio_output/01_scripts.json`

**지시**:
> 01_scripts.json을 읽고, DJ テンキ爺의 오프닝/리액션/클로징 멘트를 각 에피소드에 추가하라. 결과를 `.radio_output/02_dj_script.json` 으로 저장하라.

**완료 조건**: `.radio_output/02_dj_script.json` 파일 존재 확인

---

### STEP 3: 캐릭터 비주얼 프롬프트 생성 (casting_director)
**에이전트**: `.claude/agents/03_casting_director.md`

**입력**: `.radio_output/02_dj_script.json`

**지시**:
> 02_dj_script.json의 각 에피소드 `character` 필드를 읽고, 이미지 생성 AI용 상세 영어 프롬프트를 생성하라. portrait(1:1)과 scene(16:9) 두 가지 프롬프트를 모두 포함하라. 결과를 `.radio_output/03_character_prompts.json` 으로 저장하라.

**완료 조건**: `.radio_output/03_character_prompts.json` 파일 존재 확인

---

### STEP 4: 스토리보드 분해 (storyboard_director)
**에이전트**: `.claude/agents/04_storyboard_director.md`

**입력**: `.radio_output/02_dj_script.json`

**지시**:
> 02_dj_script.json의 각 에피소드 전체 대본(DJ 멘트 포함)을 4~6초 단위 씬으로 분해하라. 각 씬에 scene_id, 대사(일본어), 화면 묘사(영어), 씬 타입, 전환 방식을 포함하라. 결과를 `.radio_output/04_storyboard.json` 으로 저장하라.

**완료 조건**: `.radio_output/04_storyboard.json` 파일 존재 확인

---

### STEP 5: 이미지 생성 페이로드 설계 (art_director)
**에이전트**: `.claude/agents/05_art_director.md`

**입력**: `.radio_output/04_storyboard.json`, `.radio_output/03_character_prompts.json`

**지시**:
> 04_storyboard.json의 각 씬 visual_prompt_en을 Style Bible(昭和 레트로 아니메, Ghibli 팔레트)에 맞게 고도화하고, Stable Diffusion 및 DALL-E 3 API 페이로드를 각각 생성하라. 03_character_prompts.json에서 캐릭터 등장 씬은 캐릭터 시드 설명을 프롬프트 앞에 삽입하라. 결과를 `.radio_output/05_image_payloads.json` 으로 저장하라.

**완료 조건**: `.radio_output/05_image_payloads.json` 파일 존재 확인

---

### STEP 6: 오디오 스크립트 생성 (audio_director)
**에이전트**: `.claude/agents/07_audio_director.md`

**입력**: `.radio_output/02_dj_script.json`, `.radio_output/04_storyboard.json`

**지시**:
> 02_dj_script.json의 각 에피소드 대본에서 지문(행동 묘사, 괄호 내용)을 제거하고, ElevenLabs TTS용 연출 태그([pause:short/medium/long], [speed:slow/normal/fast], [noise:on/off], [bgm:fade_in/out])를 삽입하라. 씬별 분리와 ElevenLabs API 페이로드를 포함하라. 결과를 `.radio_output/07_audio_script.json` 으로 저장하라.

**완료 조건**: `.radio_output/07_audio_script.json` 파일 존재 확인

---

### STEP 7: 파이프라인 완료 보고
모든 7개 파일이 `.radio_output/` 에 생성되었는지 확인한 후 아래 형식으로 요약 보고하라:

```
✅ /make-radio 파이프라인 완료

📁 생성된 파일:
  01_scripts.json         - 일본어 사연 대본 3편
  02_dj_script.json       - DJ 멘트 추가 완료
  03_character_prompts.json - 캐릭터 이미지 프롬프트
  04_storyboard.json      - 씬 분해 (총 X씬)
  05_image_payloads.json  - 이미지 생성 페이로드
  07_audio_script.json    - TTS 오디오 스크립트

📊 통계:
  - 총 에피소드: 3개
  - 총 씬 수: X씬
  - 예상 영상 길이: 약 XX분

🚀 다음 단계: node server.mjs → http://localhost:3000 대시보드에서 결과 확인
```
