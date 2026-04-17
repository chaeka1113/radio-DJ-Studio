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

## 규칙 3: script 필드(사연자 편지)에 Audio Tag 금지

`[sighs]` 등 영문 Audio Tag는 **DJ 멘트 필드에서만 허용**.
사연자 편지(script 필드)에는 `...` 줄임표만 사용.

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

## 전달 전 체크리스트

- [ ] 모든 `[태그]` 앞뒤에 공백이 있는가?
- [ ] 일본어 문자 또는 구두점에 태그가 직접 붙어 있지 않은가?
- [ ] script 필드(사연자 편지)에 Audio Tag가 없는가?
