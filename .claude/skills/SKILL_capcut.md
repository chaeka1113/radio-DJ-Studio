# SKILL_capcut.md — CapCut 빌더 운영 수칙 & Gatchas

## 역할
`run_06_capcut_builder.mjs`는 타임라인 JSON을 생성하여
CapCut 드래프트 폴더(`CAPCUT_DRAFTS_DIR`)에 직접 배송하는 **최종 조립 스크립트**다.
실행 전 `ref_capcut_materials.json`과 루트 `draft_content.json`(마스터 템플릿)이 반드시 존재해야 한다.

---

## 운영 수칙

1. **마스터 템플릿 우선**: `draft_content.json`에서 소재를 추출해 재사용한다. 하드코딩된 파라미터는 금지.
2. **타임라인 커서 관리**: `cursor` 변수는 반드시 순서대로 전진(단방향). 역산 절대 금지.
3. **BREATHING_ROOM 수학**: 각 TTS 블록의 `sceneEnd = ttsEnd + BREATHING_ROOM`. cursor도 동일하게 전진.
4. **BGM 루핑**: `BGM_SRC_DUR_US = Math.max(bgmActualDurUs - BGM_MARGIN_US, 1_000_000)`. 0 이하 크래시 방지.
5. **QA 통과 필수**: `validateTimeline()` → `validate()` 순서로 양쪽 모두 통과해야 저장됨.
6. **Windows 경로**: `normPath()` 함수로 역슬래시 → 슬래시 변환 필수. CapCut JSON 내 경로는 항상 `/` 사용.

---

## <Gatchas> — 과거 실패 사례 오답 노트

### G1: Root ID 동기화 문제
**증상**: CapCut에서 드래프트를 열면 소재가 깨지거나 비어 보임.
**원인**: `newDraft.id`가 마스터 템플릿의 `id`와 다를 때 CapCut이 드래프트를 다른 프로젝트로 인식.
**방어 로직**: `id: template.id` — 항상 마스터 템플릿의 id를 그대로 복사. 절대 `newUUID()` 사용 금지.

### G2: Windows 경로 이스케이프 오류
**증상**: CapCut 실행 시 파일을 찾지 못함 (`C:\Users\...` 경로 오류).
**원인**: JSON 내 `\\` 이중 이스케이프 또는 역슬래시 그대로 저장.
**방어 로직**: 모든 경로를 `normPath(p)` 통과시킨 뒤 저장. `normPath = (p) => (p||'').replace(/\\/g, '/')`.

### G3: 레트로 플리커 미존재 크래시
**증상**: `TypeError: Cannot read properties of undefined (reading 'id')` in STEP 5.
**원인**: 마스터 템플릿에 레트로 플리커 효과가 없을 때 인라인 폴백에서 `id`가 undefined.
**방어 로직**: `effect_id === '7618619632592620805'`로 탐색 후 미발견 시 즉시 `process.exit(1)`.
**복구**: CapCut에서 레트로 플리커 효과를 적용한 씬 포함 상태로 마스터를 다시 추출.

### G4: BGM source_timerange 초과
**증상**: QA 실패 — "BGM source_timerange 초과 세그먼트 N개".
**원인**: `BGM_SRC_DUR_US = REF.bgm.duration` 그대로 쓰면 꼬리 정적 구간까지 포함되어 루핑 타이밍 어색.
**방어 로직**: `BGM_SRC_DUR_US = Math.max(REF.bgm.duration - 10_000_000, 1_000_000)`.

### G5: BREATHING_ROOM QA 수식 불일치
**증상**: QA2 또는 QA5 실패 (duration delta가 정확히 2,000,000µs).
**원인**: BREATHING_ROOM 패치 후 validateTimeline 수식을 업데이트하지 않음.
**방어 로직**:
- QA2: `expectedSceneDur = WHITE_IN_DUR + block.chunk.durUs + PAUSE_US`
- QA5: `expectedNOS = lastTtsEnd + PAUSE_US`
- Closing 블록도 `cursor = ttsEnd + BREATHING_ROOM`으로 전진.

### G6: 이미지 파일명 규칙 불일치
**증상**: `❌ 이미지 없음: ...SC001.png`
**원인**: `run_05_images.mjs`가 `scene_id` 기반으로 저장했는데, 빌더가 `SC{index}.png`로 탐색.
**방어 로직**: 빌더의 `makeVideoMat(index)`는 `SC${String(index+1).padStart(3,'0')}.png` 규칙 사용.
이미지 생성 스크립트와 네이밍 규칙이 반드시 일치해야 함.

### G7: draft_meta_info.json 누락
**증상**: CapCut이 드래프트 폴더를 인식하지 못함.
**원인**: `draft_content.json`만 복사하고 `draft_meta_info.json`을 누락.
**방어 로직**: 배송 단계에서 두 파일 모두 복사 확인. `master_template/draft_meta_info.json` 필수.
