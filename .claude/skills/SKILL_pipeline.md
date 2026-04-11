# SKILL_pipeline.md — 파이프라인 운영 수칙 & Gatchas

## 역할
`run_00_*.mjs` ~ `run_99_wrapup.mjs`를 순서대로 실행하여
대본 생성 → 이미지 생성 → TTS → CapCut 조립까지 완성하는 **하네스 파이프라인**.
`/go-radio` 커맨드가 오케스트레이터 역할을 한다.

---

## 파이프라인 실행 순서

```
00_trend_fetcher  → 00_trends.json
00_planner        → ref_episode_contract.json
01_script         → 01_scripts.json
01_QA             → 01_qa_result.json (실패 시 01_script 재실행)
02_dj             → 02_dj_script.json [+ 08_qa_script.json]
03_casting        → 03_character_prompts.json, ref_character_sheet.json
04_storyboard     → 04_storyboard.json, 04_storyboard_summary.json
04_visual_QA      → 04_visual_qa_result.json (인플레이스 업데이트)
05_images         → images/*.png, 05_image_results.json
07_audio          → audio/*.mp3, audio/*_timestamps.json
06_capcut_builder → capcut_output/draft_content.json → CapCut 드래프트 폴더
99_wrapup         → .claude/skills/ref_learnings.md 갱신
```

---

## 운영 수칙

1. **EP_ID 필수**: 파이프라인 시작 시 `EP_YYYYMMDD_HHMM` 형식의 ID를 생성하고 모든 산출물을 `.output/{EP_ID}/`에 격리.
2. **manifest.json 유지**: 각 스텝 완료 시 `stage` 필드를 업데이트 (`init` → `scripted` → `storyboarded` → `images_done` → `audio_done` → `capcut_done`).
3. **QA 실패 시 재시도**: `01_QA` 실패 → `01_qa_feedback.json` 생성 → `01_script` 재실행 (최대 3회).
4. **스킵 로직 활용**: `07_audio`는 `.mp3 + _timestamps.json` 쌍이 이미 존재하면 스킵. 재실행 시 불필요한 API 비용 방지.
5. **`--qa` 플래그 전파**: `go-radio.md`에서 파싱하여 `08_qa_script.json` 생성 여부를 결정. 하위 스텝(04, 07)이 파일 유무를 자동 감지.
6. **99_wrapup 항상 마지막**: QA 피드백을 `ref_learnings.md`에 압축·병합. 다음 실행에서 같은 실수 반복 방지.

---

## 에이전트 간 통신 규칙

- **전달 단위**: 전체 파일 대신 `manifest.json`의 파일 포인터만 전달.
- **04_storyboard_summary.json**: 132KB 원본 대신 다운스트림 에이전트(05_images, 07_audio)용 경량 뷰 사용.
  ```json
  { "ep_id": "...", "scenes": [{ "scene_id": "SC001", "type": "STORY", "file": "images/SC001.png" }] }
  ```
- **ref_*.md 주입**: 각 스크립트가 필요한 룰만 선택적으로 로드. 불필요한 룰 파일 통째 주입 금지.

---

## <Gatchas> — 과거 실패 사례 오답 노트

### G1: 산출물 경로 간섭 (멀티 에피소드)
**증상**: 두 번째 `/go-radio` 실행이 첫 번째 결과를 덮어씀.
**원인**: 모든 산출물이 `.radio_output/` 루트에 공유 저장.
**방어 로직**: EP_ID 격리 구조 사용. `lib/paths.mjs`의 `makePaths(epId)` 통해 경로 생성.

### G2: QA 피드백 Stale 문제
**증상**: 이전 실행의 QA 실패가 다음 실행에 영향을 주어 잘못된 방향으로 대본 재생성.
**원인**: `01_qa_feedback.json`이 새 파이프라인 시작 시 초기화되지 않음.
**방어 로직**: `00_planner.mjs` 실행 시 feedback 파일 삭제. EP_ID 격리 시 자동 해결.

### G3: 08_qa_script.json 미생성 상태에서 04_storyboard 실행
**증상**: QA 코너 DJ_SHOT이 누락된 스토리보드 생성.
**원인**: `--qa` 플래그 파싱 실패 또는 `08_qa_script.mjs` 실행 순서 오류.
**방어 로직**: `go-radio.md` STEP 4에서 `--qa` 여부 확인 후 선택적 실행.

### G4: timestamps.json 없이 capcut_builder 실행
**증상**: `❌ audio/*_timestamps.json 없음` 오류.
**원인**: `07_audio.mjs`가 실패했는데도 `06_capcut_builder`를 실행.
**방어 로직**: 각 스텝 완료 조건을 `manifest.json`의 `stage`로 검증 후 다음 스텝 진행.

### G5: ref_learnings.md 무한 성장
**증상**: 파이프라인 실행마다 learnings 파일이 비대해져 컨텍스트 낭비.
**원인**: `99_wrapup`이 압축 없이 append만 수행.
**방어 로직**: Gemini로 중복 제거 + 최대 10 bullets 유지. 새 실수 없으면 no-op.
