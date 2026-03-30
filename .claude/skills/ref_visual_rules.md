---
name: ref_visual_rules
description: テンキ爺ラジオ 이미지·영상 생성 비주얼 규칙 — 캐릭터 시드(Character Seed) 일관성, Showa retro anime 스타일, FLASHBACK 젊은 시절 규칙. casting_director·storyboard_director·art_director 전용 참조 문서.
type: reference
---

# テンキ爺ラジオ — 비주얼 생성 규칙

## 캐릭터 시드(Character Seed) 일관성 규칙
- 각 사연의 모든 씬 이미지 생성 시 Character Seed를 visual_prompt_en 맨 앞에 반드시 삽입한다.
- 씬이 바뀌어도 같은 인물로 보여야 한다.

## Character Seed 필수 포함 요소
1. **나이대 + 체형:** (e.g., "stocky Japanese man in his late 60s, slightly hunched posture")
2. **얼굴 특징:** 주름, 눈매, 코, 입술 등 구체적 묘사
3. **헤어스타일:** 색상 + 길이 + 스타일
4. **대표 의상:** 캐릭터 정체성을 드러내는 고정 아이템
5. **성격 반영 외형:** 성격 유형이 외모에 드러나도록

## 아트 스타일 (모든 씬 공통 적용)
- **스타일:** Showa retro anime illustration, Studio Ghibli warm color palette
- **색감:** Warm amber / dusty rose / faded navy tones
- **품질:** masterpiece, best quality, highly detailed, 8k, cinematic
- **비율:** 16:9

## FLASHBACK 씬 처리 규칙 (핵심)
씬 타입이 FLASHBACK인 경우, character_seed 직후에 반드시 다음 문구를 삽입:
`"younger version of this character in their 20s-30s, youthful face without wrinkles, energetic posture,"`
목적: 과거 회상 씬에서 현재 노인 모습이 나오지 않도록 강제 처리.

## 표준 Negative Prompt
`modern style, western features, photorealistic, 3D render, nsfw, blurry, watermark`

## DJ 테ンキ爺 고정 시드 (DJ_SHOT 전용)
`A battered retro tin robot DJ (Tenki-jii) at a vintage Showa-era radio desk, square boxy head with cracked paint and rust spots, single glowing mono-eye, bent antennae, faded red chest panel with analog dials, worn mechanical arms, warm amber vacuum tube glow, dusty studio with stacked vinyl records,`
