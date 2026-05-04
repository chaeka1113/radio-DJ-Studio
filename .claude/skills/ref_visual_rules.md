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

씬에 스마트폰·태블릿·TV·종이·편지 등이 등장할 때 반드시 적용.

### 핵심 원칙: 뒷면에는 화면 내용이 없다 (물리 법칙)

기기 뒷면은 물리적으로 화면이 존재할 수 없다. 카메라 각도와 무관하게, **뒷면에 화면·글씨·이미지가 그려지면 즉시 재생성**.

| 면 | 있어도 되는 것 | 절대 금지 |
|---|---|---|
| **앞면 (전면)** | 화면·디스플레이·빛·내용물 | — |
| **뒷면 (후면)** | 무광 커버 + 카메라 렌즈만 | **화면·디스플레이·발광·글씨·이미지 일체** |

---

### Case A — 캐릭터가 화면을 보는 씬 (카메라에 뒷면이 찍힘)
캐릭터가 기기를 보고 있는 경우. **구도: 캐릭터 → 기기 → 카메라**.
기기 화면은 캐릭터를 향하고, 카메라는 기기 **뒷면**을 봄.

- 스마트폰/태블릿: `character looking at the [device] screen (screen facing character, away from camera), plain matte back panel with only small circular camera lenses visible to camera — absolutely NO screen or display on the back panel. Screen glow illuminates character's face from the front.`
- TV: `camera positioned BEHIND the TV — sees only the plain matte back panel (ventilation slots, cable ports). Character in background with face front-lit by the TV screen's glow (screen faces character, away from camera).`
- 네거티브: `screen on back panel, display on back cover, rear screen, glowing back of device, TV screen facing camera, screen visible to camera`

### Case B — 캐릭터에게 화면을 보여주는 씬 (카메라에 앞면이 찍힘)
다른 사람 또는 캐릭터 스스로 화면을 카메라/상대방 쪽으로 향하는 경우. 전면 화면이 카메라에 보이는 것은 정상.

- 프롬프트: `[device] screen facing toward the character and camera, glowing front display visible`
- 네거티브: `screen on back panel, rear display, glowing back panel`

---

### 기기별 뒷면 묘사 가이드

| 기기 | 뒷면 올바른 묘사 | 절대 금지 |
|---|---|---|
| 스마트폰 | `plain matte back cover with 1-2 small circular camera lenses` | 화면, 발광, 투명 패널 |
| 태블릿 | `flat matte back panel, no screen` | 화면, 디스플레이 |
| TV | `back of TV set with cables and vents` | 화면, 발광 |
| 종이·편지 | `blank white back of paper` | 글씨, 그림 |
| 사진 | `plain white back of photograph` | 이미지, 발광 |

**모든 디바이스 등장 씬 네거티브 프롬프트 필수 추가:**
`screen on back of device, display on back panel, rear screen, glowing back panel, back panel with display`

## FLASHBACK 씬 처리 규칙 (핵심)
씬 타입이 FLASHBACK인 경우, character_seed 직후에 반드시 다음 문구를 삽입:
`"younger version of this character in their 20s-30s, (Young 20s smooth face, no wrinkles, youthful clear skin), energetic posture,"`
목적: 과거 회상 씬에서 현재 노인 모습이 나오지 않도록 강제 처리.

## 표준 Negative Prompt (강화판)
`photorealistic, 3D render, realistic, real photo, photograph, hyperrealistic, modern style, cyberpunk, neon colors, glossy texture, plastic texture, abstract, moles, beauty marks, glasses, spectacles, nsfw, blurry, watermark, western features, square format, portrait format`

## DJ テンキ爺 고정 시드 (DJ_SHOT 전용)
`(Showa retro anime, Studio Ghibli style hand-drawn illustration), A battered retro tin robot DJ (Tenki-jii) at a vintage Showa-era radio desk, square boxy head with cracked paint and rust spots, single glowing mono-eye, bent antennae, faded red chest panel with analog dials, worn mechanical arms, warm amber vacuum tube glow, dusty studio with stacked vinyl records,`
