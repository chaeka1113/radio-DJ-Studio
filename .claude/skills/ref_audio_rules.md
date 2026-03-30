---
name: ref_audio_rules
description: テンキ爺ラジオ TTS 오디오 생성 규칙 — ElevenLabs 금지 태그(의성어·괄호), 허용 지문 목록, TTS 합본 포맷. audio_director 전용 참조 문서.
type: reference
---

# テンキ爺ラジオ — 오디오 생성 규칙

## 허용 지문 (ElevenLabs가 연출로 처리하는 것)
`[間]` `[長い間]` `[溜息]` `[深い息]` `[少し優しく]` `[ゆっくりと]`
`[荒々しく速い口調で]` `[低く呟きながら]` `[馬鹿にするように]` `[自嘲気味に]`
`[哲学的に]` `[力強く]` `[3秒停止]`

## 절대 금지 (TTS가 그대로 읽어버리는 텍스트)
- **노이즈 의성어:** ジジジ / ガガッ / ブーン / ギギギ / ザザッ / ジー 등
- **행동 묘사 괄호:** （オイルを飲む）（歯車が回る）등 일본어 괄호（）안의 행동묘사
- **효과음 태그:** [ドン！] [バン！] [ガチャン] 등

## TTS 합본 포맷
```
【テンキ爺】
DJ 멘트 본문 (허용 지문 포함)

【ナレーター（이름・나이）】
사연 본문 (허용 지문 없음)
```

## 오염 텍스트 자동 클리닝 규칙
1. 노이즈 의성어 정규식 제거: /ジジジ+/g, /ガガ+/g, /ブーン+/g, /ギギギ+/g, /ザザッ+/g, /ジー+/g
2. 행동 묘사 괄호 제거: /（[^）]*）/g
3. 일본어 문자 포함 브래킷 태그 제거: /\[[^\]]*[\u3040-\u9fff][^\]]*\]/g
4. SSML 태그 제거: /<[^>]+>/g
5. 연속 공백/개행 정리

---

## [Learnings] 버그 픽스 기록

### BUG-01: MP3 Buffer 단순 concat → 오디오 호흡 파괴
**증상:** 화자·코너 전환 시 0.1초 틈도 없이 급하게 이어짐, 방송 품질 저하.
**원인:** `Buffer.concat(buffers)`로 MP3 바이너리를 단순 붙임 → 헤더/프레임 경계 무시.
**해결:** FFmpeg `concat demuxer` + `silence_1.5s.mp3` 삽입.
**재발 방지 규칙:**
> MP3는 절대 Node.js Buffer로 단순 concat하지 말 것.
> 반드시 FFmpeg로 `anullsrc` 기반 1.5초 묵음 파일을 생성한 뒤
> `list.txt` concat demuxer로 병합할 것.
> 명령어: `ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t 1.5 -q:a 9 -acodec libmp3lame silence_1.5s.mp3`

### BUG-02: chunk3에서 엔딩 멘트 2회 TTS 전송
**증상:** 방송 마지막에 동일한 엔딩 멘트가 두 번 재생됨.
**원인:** `run_02_dj.mjs`에서 `08_qa_script.json` 저장 시 `outro: merged.show_closing`으로
`show_closing`을 그대로 복사. chunk3Items 구성 시 `qaScript.outro`와 `djScript.show_closing`을
모두 push하면 동일 텍스트가 2번 TTS 엔진으로 전달됨.
**해결:** `chunk3Items`에서 `qaScript.outro` push를 완전 삭제.
`djScript.show_closing`만 마지막에 단 한 번 push.
**재발 방지 규칙:**
> chunk3 구성 시 QA 코너가 있어도 `qaScript.outro`는 절대 push하지 말 것.
> 전체 방송의 엔딩(`show_closing`)은 QA 유무와 관계없이 배열의 맨 마지막에 단 한 번만 삽입.
