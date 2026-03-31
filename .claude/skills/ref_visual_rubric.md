---
name: ref_visual_rubric
description: テンキ爺ラジオ 시각 프롬프트 가중치 평가표 — Casting Director(03)·Storyboard Director(04) 생성 전 필독, Visual QA Evaluator(run_04_visual_QA.mjs) 채점 기준. 커트라인 90점.
type: reference
---

# テンキ爺ラジオ — 시각 프롬프트 가중치 평가표 (Visual Rubric)

> **Generator 주의:** 이 평가표는 프롬프트 생성 직후 Visual QA에 의해 항목별로 엄격히 채점된다.
> 커트라인 90점 미만 = Auto-fix 강제 교정 (Max 3 Retries).
> 40점짜리 감점 항목(캐릭터 일관성 위반, 금지 스타일 사용)을 원천 차단하여 생성하라.

---

## 항목 1 — 캐릭터 일관성 및 시니어 네거티브 제약 [배점 40점] ⚠️ 가장 중요

### 1-A. 긍정 프롬프트 Visual Anchor 규칙 [20점] ⚠️ ABSOLUTE PROHIBITION

**visual_prompt_en (Positive Prompt) 안에는 아래 금지 명사가 1글자도 들어가선 안 된다.**
부정형("no moles", "no glasses")으로 써도 AI는 해당 오브젝트를 시각화하므로 청개구리처럼 그려버린다.

| 절대 금지 명사 (positive_prompt 내 사용 금지) | 올바른 대체 표현 |
|---|---|
| `mole`, `beauty mark`, `spot` (점) | `clean smooth face, flawless complexion` |
| `glasses`, `spectacles`, `eyewear` (안경) | `bare face` — 눈은 색상·형태로 직접 묘사 |
| `wrinkles` (젊은 층 캐릭터의 경우) | `smooth youthful skin, age-appropriate features` |

**만점 조건:** visual_prompt_en에 위 금지 명사가 전혀 없으며, 얼굴 피부는 반드시 `clean, perfectly clear skin, flawless complexion` (로봇인 テンキ爺의 경우 `seamless clean metal surface`)로만 묘사됨.
**위반 시:** 금지 명사 1개 발견당 -10점 (최대 -20점). Auto-fix: 금지 명사 전체 제거 후 올바른 대체 표현으로 교체.

### 1-B. 금지 스타일 네거티브 묘사 [20점] ⚠️ CRITICAL
시니어 타겟 방송에 이질적인 스타일이 **프롬프트에 등장하거나, negative_prompt에서 명시적으로 제외되지 않으면** 즉시 감점.

**절대 금지 키워드 (positive_prompt 등장 또는 negative_prompt 누락 시 -20점 전체):**

| 금지 스타일 | 이유 |
|---|---|
| `Hyper-modern Transformer style` | 소와 레트로와 완전 상충 |
| `cyberpunk` | 시니어 타겟 세계관 파괴 |
| `neon colors` | 昭和 온기 톤과 상충 |
| `glossy/plastic textures` | 레트로 아날로그 감성 파괴 |
| `abstract composition` | 캐릭터 중심 서사 불가 |

**negative_prompt에 반드시 포함해야 할 키워드:**
```
modern style, cyberpunk, neon colors, glossy texture, plastic texture,
abstract, photorealistic, 3D render, nsfw, blurry, watermark, western features
```

**만점 조건:** positive_prompt에 금지 키워드 없음 + negative_prompt에 금지 스타일 모두 명시됨.

---

## 항목 2 — 물리적 리얼리즘 [배점 30점]

캐릭터와 사물의 상호작용이 물리법칙에 따라 **텍스트로 명확히 묘사**되어야 한다.

| 규칙 | 올바른 예시 | 잘못된 예시 (감점) |
|------|-----------|-----------------|
| 쥐는 동작 명시 | `physically holding a smartphone firmly in hand` | `with a smartphone` (떠 있는지 불명) |
| 접촉/연결 명시 | `holding hands tightly, fingers interlocked` | `hands together` |
| 발이 땅에 닿음 | `feet firmly on the ground, standing upright` | 발 묘사 없음 + 공중 부유 위험 |
| 사물 위치 명시 | `cup placed on the table in front of them` | `a cup nearby` |

**감점 기준:**
- 공중에 뜬 사물이나 비현실적 배치 묘사 발견 시: -15점
- 상호작용 동사 없이 사물만 언급 시: -10점
- 물리적 접촉 묘사 완전 누락 시: -5점

**만점 조건:** 모든 사물/신체 접촉이 구체적 동사와 위치 정보로 명확히 묘사됨.

---

## 항목 3 — 아트 스타일 일관성 [배점 30점]

모든 씬의 `visual_prompt_en` 끝에 아래 표준 아트 스타일 지시어가 **누락 없이** 포함되어야 한다.

### 필수 스타일 지시어 (매 씬 끝에 포함)
```
Showa retro anime illustration, Studio Ghibli warm color palette,
warm amber/dusty rose/faded navy tones, masterpiece, best quality,
highly detailed, 8k, cinematic
```

### 비율 처리 주의사항 ⚠️
- `--ar 16:9` 같은 **Midjourney 파라미터는 절대 텍스트 프롬프트에 삽입 금지**
- 비율(aspect ratio)은 Imagen API Payload에서 별도 처리됨
- 프롬프트에 `16:9` 비율 숫자 자체는 허용 (Midjourney 문법 `--ar`만 금지)

**감점 기준:**
- `Showa retro anime illustration` 누락: -15점
- `Studio Ghibli warm color palette` 누락: -10점
- `masterpiece, best quality` 누락: -5점
- `--ar` Midjourney 파라미터 발견: -10점 (즉시 삭제)

**만점 조건:** 표준 지시어 완전 포함, Midjourney 파라미터 없음.

---

## 커트라인 및 판정

| 총점 | 판정 | 조치 |
|------|------|------|
| 90점 이상 | **Pass** | 다음 단계(Imagen 4.0 이미지 생성) 진행 |
| 90점 미만 | **Auto-fix** | 감점 사유 기반으로 프롬프트 자동 교정 (Max 3 Retries) |

---

## Auto-fix Actionable Feedback 형식

```
[항목명] -XX점 감점: 위반 내용. Auto-fix 행동: 즉각적이고 명확한 교정 지시
```

예시:
- `[금지 스타일] -20점 감점: negative_prompt에 'cyberpunk' 미포함. Auto-fix: negative_prompt에 'cyberpunk, neon colors, glossy texture, plastic texture, abstract' 추가.`
- `[물리적 리얼리즘] -15점 감점: 스마트폰이 공중에 떠 있는 묘사 'with a smartphone'. Auto-fix: 'physically holding a smartphone firmly in right hand, screen facing forward'로 교체.`
- `[아트 스타일] -15점 감점: 'Showa retro anime illustration' 누락. Auto-fix: visual_prompt_en 끝에 표준 스타일 지시어 전체 추가.`
