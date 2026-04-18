---
name: ref_tts_v3_core
description: テンキ爺ラジオ TTS 핵심 규칙 — ElevenLabs V3 포맷팅 강제 규칙. run_07_audio.mjs 전용. 944줄 전체 스펙은 ref_tts_v3_rules.md 참조.
type: reference
---

# ElevenLabs V3 TTS — 프로젝트 전용 강제 규칙

## 규칙 1: 오디오 태그 앞뒤 공백 필수

`[sighs]` `[scoffs]` `[laughs]` 등 V3 Audio Tag는 **반드시 앞뒤 공백 1칸 이상** 확보.
붙어 있으면 TTS 엔진이 태그를 텍스트로 병합하거나 발음이 부자연스러워짐.

| 형식 | 예시 |
|------|------|
| ❌ 잘못됨 | `コノヤロー！[sighs]まったく` |
| ✅ 올바름 | `コノヤロー！ [sighs] まったく` |

## 규칙 2: 문장 부호 뒤 태그 — 말줄임표로 휴지 강화 (권장)

```
# 기본
だと？ [scoffs] そんな話があるか

# 권장 (자연스러운 호흡 휴지)
だと？... [scoffs] ...そんな話があるか
```

## 규칙 3: script 필드(사연자 편지) Audio Tag 허용 범위

사연자 편지(script 필드)에도 영문 Audio Tag 사용 가능. 단 아래 제한 준수:

| 구분 | 허용 태그 |
|------|-----------|
| 감정 | `[sighs]` `[laughs]` `[chuckles]` `[sad]` `[nervous]` `[excited]` `[surprised]` `[whispers]` |
| 빌런 한정 | `[angry]` `[scoffs]` (is_villain=true 캐릭터만) |
| 금지 | 효과음 계열 (`[applause]` `[gunshot]` 등), 일본어 태그, SSML |

**사용 기준**: 800〜1,000字 당 1〜3개. 감정 절정 순간에만 삽입. 연속 사용 금지.

## 규칙 4: 완전 금지 항목

| 금지 | 이유 |
|------|------|
| `[溜息]` `[間]` 등 일본어 태그 | V3 미지원 |
| `（行動묘사）` 일본어 괄호 | 텍스트로 읽혀버림 |
| `<break time="1s"/>` SSML | V3 완전 미지원 |
| `ジジジ` `ガガッ` `ブーン` 노이즈 의성어 | 음성 아티팩트 유발 |

## 규칙 5: 허용 Audio Tag 목록

```
[sighs] [laughs] [chuckles] [scoffs] [angry] [whispers]
[surprised] [sad] [excited] [nervous] [clears throat]
[inhales sharply] [exhales slowly]
```

## 규칙 6: API 요청 강화 (v3 고급 기능)

- `language_code: "ja"` — 모든 요청에 포함 (일본어 발음·억양 정확도 향상)
- `previous_request_ids` — DJ(テンキ爺) 목소리만 해당. 직전 최대 3개 요청 ID를 넘겨 방송 내 목소리 일관성 유지. 사연자 목소리는 적용 안 함.

## 규칙 7: DJ 텍스트 Audio Tag 자동 보강

DJ 텍스트에 Audio Tag가 2개 이하일 때 `autoInjectDJTags()`가 패턴 기반으로 자동 삽입:

| 감정 패턴 | 삽입 태그 |
|---|---|
| `まったく` `ふん` `フン` | `[scoffs]` |
| `はぁ` `ふぅ` `やれやれ` | `[sighs]` |
| `（笑）` | `[laughs]` |
| `（苦笑）` | `[chuckles]` |
| `！！` | `[excited]` |
| `なんと` | `[surprised]` |
| `ほほう` `？？` | `[curious]` |

## 전달 전 체크리스트

- [ ] 모든 `[태그]` 앞뒤에 공백이 있는가?
- [ ] 일본어 문자 또는 구두점에 태그가 직접 붙어 있지 않은가?
- [ ] script 필드(사연자 편지)에 Audio Tag가 없는가?
- [ ] `language_code: "ja"` 포함되었는가?
- [ ] DJ 호출 시 `previous_request_ids` 전달되었는가?
