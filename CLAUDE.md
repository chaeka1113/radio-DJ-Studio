# テンキ爺ラジオ — 프로젝트 하네스 문서

## 무엇인가
일본 시니어 심야라디오「テンキ爺の電波局」유튜브 영상을 전자동 생성하는 파이프라인.
주제 3개 → 대본 → DJ 멘트 → 이미지 → TTS → CapCut 드래프트 출력.

## 실행
```
/go-radio                                  # 트렌드 자동 수집
/go-radio テーマ1 テーマ2 テーマ3          # 주제 직접 지정
/go-radio テーマ1 テーマ2 テーマ3 --qa    # Q&A 코너 추가
```

## 디렉토리 지도
```
.claude/agents/       에이전트 정의 (01~09) — 각 스텝의 역할·입출력 계약
.claude/skills/       도메인 규칙 문서 (ref_*.md) + 운영 가이드 (SKILL_*.md)
.radio_output/        실행 스크립트 (run_*.mjs) + 공통 라이브러리 (lib/)
.output/{EP_ID}/      모든 산출물 — 에피소드별 격리, 직접 편집 금지
```

## 절대 금지
1. `.output/` 산출물 직접 편집 — 파이프라인이 덮어씀
2. `ref_*.md` AI 자동 생성 금지 — 성능 저하, 반드시 사람이 작성
3. `lib/paths.mjs`의 `makePaths()` 우회한 경로 하드코딩 금지
4. `run_*.mjs` EP_ID 없이 단독 실행 금지
5. DJ 이름 「テンキ爺」외 다른 이름 사용 금지 — 상세는 `ref_persona_rules.md`

## 규칙 위치 (단일 출처 원칙)
- DJ 캐릭터 규칙 → `ref_persona_rules.md`
- 대본 작성 규칙 → `ref_script_rules.md`
- QA 채점 기준 → `ref_script_rubric.md`
- 일본 수치 데이터 → `ref_japan_facts.md`
- TTS 포맷 규칙 → `ref_tts_v3_core.md`
- 파이프라인 운영 → `SKILL_pipeline.md`
