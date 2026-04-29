---
name: ref_visual_rules
description: テンキ爺ラジオ 이미지·영상 생성 비주얼 규칙 — 캐릭터 시드(Character Seed) 일관성, Showa retro anime 스타일, FLASHBACK 젊은 시절 규칙. casting_director·storyboard_director·art_director 전용 참조 문서.
type: reference
---

# テンキ爺ラジオ — 비주얼 생성 규칙

## 비주얼 앵커(Visual Anchor) 시스템 — 최우선 규칙

모든 씬의 `visual_prompt_en`은 반드시 아래 두 앵커로 시작한다.

### 앵커 1 — 작화 고정 앵커 (Style Lock)
모든 씬 프롬프트 맨 앞에 고정:
`(Showa retro anime, Studio Ghibli style hand-drawn illustration),`

### 앵커 2 — 나이 고정 앵커 (Age Lock)
캐릭터 시드 직후에 캐릭터 나이에 따라 아래 중 해당 문구를 삽입:
- 20대 이하: `(Young 20s smooth face, no wrinkles, youthful clear skin),`
- 30대: `(30s face, minimal fine lines, young-adult appearance),`
- 40~55세: `(Middle-aged face, visible laugh lines, mature look),`
- 56~69세: `(60s face, clear deep wrinkles, salt-and-pepper or gray hair),`
- 70세 이상: `(Deeply wrinkled 70s+ face, heavy age lines, white or gray hair),`
- FLASHBACK 씬: 나이 앵커 대신 `(Young 20s smooth face, no wrinkles, youthful clear skin),` 고정

### 앵커 적용 예시
```
(Showa retro anime, Studio Ghibli style hand-drawn illustration), [character_seed], (60s face, clear deep wrinkles, salt-and-pepper hair), [scene action/setting], Showa retro anime illustration...
```

---

## 캐릭터 시드(Character Seed) 일관성 규칙
- 각 사연의 모든 씬 이미지 생성 시 Character Seed를 visual_prompt_en 앞에 반드시 삽입한다.
- 씬이 바뀌어도 같은 인물로 보여야 한다.

## Character Seed 필수 포함 요소
1. **나이대 + 체형:** (e.g., "stocky Japanese man in his late 60s, slightly hunched posture")
2. **얼굴 특징:** 주름, 눈매, 코, 입술 등 구체적 묘사. **절대 금지: mole, beauty mark 등 점 묘사**
3. **헤어스타일:** 색상 + 길이 + 스타일
4. **대표 의상:** 캐릭터 정체성을 드러내는 고정 아이템
5. **성격 반영 외형:** 성격 유형이 외모에 드러나도록

### Character Seed 절대 금지 사항
- ❌ `mole`, `beauty mark`, `freckle` — 점류 묘사 일체 금지 (일관성 붕괴 원인)
- ❌ 부정형 지시어(`no moles`, `NO glasses`) — Negative Prompt에서 처리하므로 Character Seed에 쓰지 말 것
- ❌ `glasses`, `spectacles` — 시나리오상 명시된 경우에만 허용. 미착용이면 언급 자체 금지
- ✅ 얼굴 묘사는 절대적 상태 묘사로 작성: "clean smooth skin with natural aging features only"

## 아트 스타일 (모든 씬 공통 적용)
- **스타일:** Showa retro anime illustration, Studio Ghibli warm color palette
- **색감:** Warm amber / dusty rose / faded navy tones
- **품질:** masterpiece, best quality, highly detailed, 8k, cinematic
- **비율:** API parameter로 16:9 지정 (텍스트 프롬프트에 `16:9` 삽입 불필요)

## 디바이스·사진 화면 방향 규칙 (CRITICAL)

씬에 스마트폰·태블릿·사진·편지 등을 들고 있는 장면이 포함될 때 반드시 적용:

**핵심 원칙: 기기를 보는 장면에서는 반드시 전면 화면(GLOWING FRONT SCREEN)이 캐릭터 얼굴과 마주해야 한다. 화면 빛이 캐릭터 얼굴을 비추는 광원 논리를 항상 포함한다. 뒷판·후면 카메라·포트는 절대 묘사 금지.**

| 상황 | 올바른 프롬프트 예시 |
|---|---|
| 스마트폰 보는 장면 | `character looking directly at the GLOWING FRONT SCREEN of the smartphone, face-to-face with active screen, screen light casting onto character's face` |
| 태블릿 보는 장면 | `character looking directly at the GLOWING FRONT SCREEN of the tablet, face illuminated by screen light` |
| TV 보는 장면 | `character facing the GLOWING FRONT SCREEN of the television, screen light as main light source casting onto character's face` |

**절대 금지:** 뒷판(back side), 후면 카메라(rear camera), 방열구, 포트, 폰 케이스 후면 묘사.

**프롬프트 필수 문구 (디바이스 등장 씬 전용):**
`GLOWING FRONT SCREEN of [device], face-to-face with active screen, screen is the main light source casting light onto character's face`

**네거티브 프롬프트 필수 추가:**
`NO BACK SIDE of device, NO rear cover, NO device cameras, NO ports or wires on device back, NO phone case`

## FLASHBACK 씬 처리 규칙 (핵심)
씬 타입이 FLASHBACK인 경우, character_seed 직후에 반드시 다음 문구를 삽입:
`"younger version of this character in their 20s-30s, (Young 20s smooth face, no wrinkles, youthful clear skin), energetic posture,"`
목적: 과거 회상 씬에서 현재 노인 모습이 나오지 않도록 강제 처리.

## 표준 Negative Prompt (강화판)
`photorealistic, 3D render, realistic, real photo, photograph, hyperrealistic, modern style, cyberpunk, neon colors, glossy texture, plastic texture, abstract, moles, beauty marks, glasses, spectacles, nsfw, blurry, watermark, western features, square format, portrait format`

## DJ テンキ爺 고정 시드 (DJ_SHOT 전용)
`(Showa retro anime, Studio Ghibli style hand-drawn illustration), A battered retro tin robot DJ (Tenki-jii) at a vintage Showa-era radio desk, square boxy head with cracked paint and rust spots, single glowing mono-eye, bent antennae, faded red chest panel with analog dials, worn mechanical arms, warm amber vacuum tube glow, dusty studio with stacked vinyl records,`
