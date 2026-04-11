# SKILL_audio.md — 오디오/TTS 운영 수칙 & Gatchas

## 역할
`run_07_audio.mjs`는 ElevenLabs API로 TTS를 생성하고
`audio/{chunk_id}.mp3` + `audio/{chunk_id}_timestamps.json` 쌍으로 저장한다.
`run_06_capcut_builder.mjs`의 타임라인 계산이 이 파일들에 직접 의존한다.

---

## Chunk 구조 (파일명 규칙 — 절대 변경 금지)

```
00_opening.mp3                 오프닝 (テンキ爺 인사 + 날씨)
01_ep1_story.mp3               EP1 사연 낭독
02_ep1_dj.mp3                  EP1 DJ 리액션
03_ep2_story.mp3               EP2 사연 낭독
04_ep2_dj.mp3                  EP2 DJ 리액션
05_ep3_story.mp3               EP3 사연 낭독
06_ep3_dj.mp3                  EP3 DJ 리액션
07_qa_and_closing.mp3          즉문즉답 + 엔딩 (--qa 시 QA 포함)
```

`chunk_id` 파싱 규칙: `{idx}_{ep?}_{type}` — `run_06_capcut_builder.mjs` Line ~141.
이 규칙이 깨지면 capcut_builder가 chunk 분류에 실패한다.

---

## 운영 수칙

1. **스킵 로직**: `.mp3 + _timestamps.json` 쌍이 모두 존재하고 크기가 0 이상이면 재생성 스킵. API 비용 절감.
2. **오염 텍스트 제거**: TTS 전송 전 `[`, `]`, `※`, `—`, `──`, 괄호 주석 등 자동 제거. `ref_tts_v3_rules.md` 준수.
3. **청크 분할 기준**: `02_dj_script.json`의 `sections` 배열 순서 기준. QA 코너(`08_qa_script.json`) 존재 시 closing 앞에 삽입.
4. **타임스탬프 보존**: ElevenLabs `/v1/text-to-speech/{voice_id}/with-timestamps` 엔드포인트 사용. `alignment.characters` + `character_end_times_seconds` 필드 필수.
5. **ffprobe 검증**: 저장 후 ffprobe로 실제 duration 재확인. 0초 파일 저장 방지.

---

## <Gatchas> — 과거 실패 사례 오답 노트

### G1: _timestamps.json 없이 capcut_builder 실행
**증상**: `❌ audio/*_timestamps.json 없음 — run_07_audio.mjs 먼저 실행`.
**원인**: TTS 생성은 성공했으나 타임스탬프 저장이 실패(빈 응답 처리 누락).
**방어 로직**: `processChunk()` 결과가 비어 있으면 해당 chunk 스킵 + 경고 로그. capcut_builder는 timestamps 파일 존재 여부를 전제조건으로 검증.

### G2: 청크 ID 파싱 실패
**증상**: `chunk_id 파싱 실패: {chunk_id}` 오류로 capcut_builder 종료.
**원인**: `run_07_audio.mjs`가 chunk id를 `{idx}_{ep}_{type}` 규칙 외 형태로 저장.
**방어 로직**: chunk id는 `07_audio.mjs`의 `audioChunks` 배열에서 `id` 필드로 명시적 정의. 변경 시 `run_06_capcut_builder.mjs` Line ~141의 regex도 함께 수정.

### G3: ElevenLabs 429 Rate Limit 무한 재시도
**증상**: 스크립트가 멈추지 않고 무한 루프.
**원인**: 재시도 로직에 최대 횟수 제한 없음.
**방어 로직**: 최대 5회 재시도, 지수 백오프(1s → 2s → 4s → 8s → 16s). 5회 초과 시 해당 chunk 실패 처리.

### G4: ffprobe duration과 timestamps 마지막 시간 불일치
**증상**: capcut_builder 타임라인 계산 오차 발생.
**원인**: ElevenLabs가 반환한 마지막 character end_time이 실제 mp3 duration보다 짧음.
**방어 로직**: `calcSceneDurations()`에서 `chunk.durSec`(ffprobe 기준)을 마지막 cutPoint로 강제 사용.

### G5: 오디오 채널 매핑 오류
**증상**: CapCut에서 TTS 볼륨이 한쪽 채널에만 출력.
**원인**: ElevenLabs 출력이 모노인데 CapCut이 스테레오로 인식.
**방어 로직**: `sound_channel_mappings`의 `audio_channel_mapping: 0` (자동). 수동 설정 금지.
