# テンキ爺ラジオ — 에이전트 공통 포인터

> 이 파일은 "어디에 무엇이 있는가"만 담는다. 규칙 내용은 각 ref_*.md가 단일 출처.

## 파이프라인 순서
`00_trend → 00_planner → 01_script → 01_QA → 02_dj → 03_casting → 04_storyboard → 04_visual_QA → 05_images → 07_audio → 06_capcut → 99_wrapup`
`--qa` 플래그 시: `02_dj` 직후 `08_qa` 추가 실행.
상세 운영 수칙 + 과거 실패 사례 → `SKILL_pipeline.md`

## 도메인 규칙 파일 맵

| 파일 | 사용 스텝 | 내용 |
|------|-----------|------|
| `ref_persona_rules.md` | 02_dj, 08_qa | テンキ爺 페르소나, 1인칭, 금지 표현 |
| `ref_script_rules.md` | 01_script | 대본 작성 규칙, 사실성, 후크 |
| `ref_script_rubric.md` | 01_script, 01_QA | QA 채점 기준 (85점 커트라인) |
| `ref_japan_facts.md` | 01_script, 01_QA | 일본 실제 가격·연금·시급 데이터 |
| `ref_visual_rules.md` | 03_casting, 04_storyboard | 이미지 프롬프트 규칙 |
| `ref_visual_rubric.md` | 03_casting, 04_storyboard, 04_visual_QA | 비주얼 QA 기준 |
| `ref_tts_v3_core.md` | 07_audio | TTS 핵심 포맷 규칙 (태그 공백 등) |
| `ref_learnings.md` | 01_script | 누적 오답 노트 (run_99_wrapup이 자동 갱신) |

## QA 자동 강제 루프
`generate → QA(Stage1 프로그래매틱 + Stage2 LLM 루브릭)`
Fail(85점 미만) → `01_qa_feedback.json` → 재작업 프롬프트 주입 → 최대 3회

## 경로 규약
모든 파일 경로는 `lib/paths.mjs`의 `makePaths(epId)` 반환값으로만 참조.
에이전트 정의는 `.claude/agents/0N_*.md`, 실제 실행은 `run_*.mjs`.
