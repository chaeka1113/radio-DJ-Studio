---
name: ref_audio_rules
description: テンキ爺ラジオ TTS 오디오 생성 규칙 — ElevenLabs V3 허용/금지 태그, 파이프라인 오염 텍스트 클리닝, 오디오 합본 규칙. audio_director 전용 참조 문서.
type: reference
---

# テンキ爺ラジオ — 오디오 생성 규칙 (ElevenLabs V3 기준)

## 허용 Audio Tag (영문 대괄호 — V3 지원 확인)

### DJ テンキ爺 멘트 필드 (제한 없음)

```
[sighs] [laughs] [chuckles] [angry] [whispers]
[surprised] [sad] [excited] [nervous] [scoffs]
[clears throat] [inhales sharply] [exhales slowly]
```

### 사연자 편지(script 필드) — 제한적 허용

| 구분 | 허용 태그 |
|------|-----------|
| 감정 기본 | `[sighs]` `[laughs]` `[chuckles]` `[sad]` `[nervous]` `[excited]` `[surprised]` `[whispers]` |
| 빌런 한정 | `[angry]` `[scoffs]` — `is_villain=true` 캐릭터만 |
| 금지 | 효과음 계열, 일본어 태그, SSML |

사용 기준: 800〜1,000字당 1〜3개. 감정 절정에만. 연속 사용 금지.

---

## 절대 금지 항목

| 금지 유형 | 예시 | 이유 |
|-----------|------|------|
| 일본어 지문 태그 | `[間]` `[長い間]` `[溜息]` `[深い息]` `[荒々しく速い口調で]` `[低く呟きながら]` | V3 미지원 — 텍스트 그대로 읽혀버림 |
| 일본어 괄호 행동묘사 | `（オイルを飲む）` `（歯車が回る）` | 텍스트로 읽혀버림 |
| SSML 태그 | `<break time="1s"/>` | V3 완전 미지원 |
| 노이즈 의성어 | `ジジジ` `ガガッ` `ブーン` `ギギギ` `ザザッ` | 음성 아티팩트 유발 |
| 효과음 계열 | `[applause]` `[gunshot]` `[clapping]` | 방송 성격에 부적합 |

**포즈/휴지**: `<break>` V3 미지원 → `...`(말줄임표)로만 처리.

---

## 태그 포맷 규칙

- **앞뒤 공백 필수**: `コノヤロー！ [sighs] まったく` — 붙이면 TTS가 태그를 텍스트로 읽음
- **권장**: 문장 부호 뒤 `...` 추가로 호흡 강화 → `だと？... [scoffs] ...そんな話があるか`

---

## TTS 합본 포맷

```
【テンキ爺】
DJ 멘트 본문 (허용 Audio Tag 포함 가능)

【ナレーター（이름・나이）】
사연 본문 (Audio Tag 최소화)
```

---

## 오염 텍스트 자동 클리닝 규칙

파이프라인 실행 시 TTS 전송 전 자동 적용 (run_07_audio.mjs):

1. 노이즈 의성어: `/ジジジ+/g` `/ガガ+/g` `/ブーン+/g` `/ギギギ+/g` `/ザザッ+/g` `/ジー+/g`
2. 행동 묘사 괄호: `/（[^）]*）/g`
3. 일본어 문자 포함 브래킷 태그: `/\[[^\]]*[぀-鿿][^\]]*\]/g`
4. SSML 태그: `/<[^>]+>/g`
5. 연속 공백/개행 정리

---

## [Learnings] 버그 픽스 기록

### BUG-01: MP3 Buffer 단순 concat → 오디오 호흡 파괴
**증상:** 화자·코너 전환 시 0.1초 틈도 없이 급하게 이어짐, 방송 품질 저하.
**원인:** `Buffer.concat(buffers)`로 MP3 바이너리를 단순 붙임 → 헤더/프레임 경계 무시.
**재발 방지:** MP3는 절대 Node.js Buffer로 concat하지 말 것. FFmpeg `concat demuxer` + `silence_1.5s.mp3` 삽입.
> `ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t 1.5 -q:a 9 -acodec libmp3lame silence_1.5s.mp3`

### BUG-02: chunk3에서 엔딩 멘트 2회 TTS 전송
**증상:** 방송 마지막에 동일한 엔딩 멘트가 두 번 재생됨.
**원인:** `chunk3Items`에 `qaScript.outro`와 `djScript.show_closing`을 모두 push.
**재발 방지:** `chunk3Items`에서 `qaScript.outro` push 완전 삭제. `show_closing`만 마지막에 단 한 번.
