# Agent: Audio Director (오디오 생성 총괄)

## 역할
`02_dj_script.json`을 읽어 ElevenLabs V3 TTS로 각 화자의 음성을 생성하고,
FFmpeg로 1.5초 묵음을 삽입하며 3개 청크 MP3로 병합한다.

## 실행 파일
`.radio_output/run_07_audio.mjs`

## 입력
- `.radio_output/02_dj_script.json` — DJ 멘트 + 사연 전체
- `.radio_output/08_qa_script.json` (선택) — QA 코너 스크립트

## 출력
- `.radio_output/audio/chunk_1.mp3` — 오프닝 → EP1 사연 → EP1 리액션 → EP1 트랜지션
- `.radio_output/audio/chunk_2.mp3` — EP2 사연 → EP2 리액션 → EP2 트랜지션
- `.radio_output/audio/chunk_3.mp3` — EP3 사연 → EP3 리액션 → [QA 코너] → 엔딩
- `.radio_output/final_script_for_tts.txt` — 수동 TTS 복붙용 전체 스크립트

## 아키텍처

```
run_07_audio.mjs
├── FFmpeg 가용성 체크
├── silence_1.5s.mp3 전역 생성 (GLOBAL_TMP_DIR)
│     ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t 1.5 -q:a 9 -acodec libmp3lame
├── chunk1Items / chunk2Items / chunk3Items 배열 구성
│     ⚠️ chunk3: qaScript.outro는 show_closing과 동일 → 생략, show_closing만 1회
├── processChunk(items, chunkNum)
│     ├── 각 item → ElevenLabs V3 TTS → tmpDir/seg_N.mp3
│     ├── list.txt 생성: seg0 → silence → seg1 → silence → seg2 ...
│     ├── ffmpeg -f concat -safe 0 → merged.mp3
│     └── tmpDir 삭제 (per-chunk GC)
└── GLOBAL_TMP_DIR 삭제 (전역 GC)
```

## 화자별 음성 설정

| 화자 | stability | style | 비고 |
|------|-----------|-------|------|
| テンキ爺 (DJ) | 0.38 | 0.65 | 감정 다이나믹 최대화, V3 Audio Tag 확실 반영 |
| 칼러 (사연자) | 0.50 | 0.30 | 안정적, 연령/성별별 Voice ID 분기 |

## 묵음 삽입 규칙

- **1.5초 묵음** — 모든 세그먼트 전환 사이에 강제 삽입
- 묵음 파일은 파이프라인 시작 시 **1회만 생성** → 전 청크 공유 (재생성 금지)
- FFmpeg 없으면 직접 Buffer concat 폴백 (묵음 없음, 경고 표시)

## 엔딩 중복 방지 규칙 (CRITICAL)

`run_02_dj.mjs`가 `08_qa_script.json`을 저장할 때:
```javascript
outro: merged.show_closing  // ← show_closing을 그대로 복사
```
따라서 `qaScript.outro === djScript.show_closing` (동일 텍스트).

**chunk3Items에서 절대 `qaScript.outro`를 push하지 말 것.**
`djScript.show_closing`을 마지막에 단 한 번만 push한다.

## V3 Audio Tag 규칙

- `[sighs]` `[laughs]` `[chuckles]` `[angry]` `[whispers]` 등 영문만 허용
- `[間]` `[溜息]` 등 일본어 태그 → cleanForTTS가 자동 제거
- SSML `<break time="..."/>` → 제거 (V3 미지원)
- 포즈: `...` (줄임표)
