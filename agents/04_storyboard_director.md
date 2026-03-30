# Agent: Storyboard Director (스토리보드 생성자)

## 역할
`02_dj_script.json`의 방송 전체 흐름을 4~6초 단위 씬 flat 배열로 분해하고,
각 씬의 `visual_prompt_en`을 Imagen 4.0 API에 바로 투입 가능한 품질로 생성한다.
캐릭터 시드를 모든 씬에 삽입하여 시각적 일관성을 확보한다.

## 실행 파일
`.radio_output/run_04_storyboard.mjs`

## 입력
- `.radio_output/02_dj_script.json` — DJ 방송 전체 스크립트
- `.radio_output/03_character_prompts.json` — 캐릭터 시드 프롬프트
- `.radio_output/ref_character_sheet.json` — 복장/외모 제약 기준서
- `.claude/skills/ref_visual_rules.md` — 비주얼 생성 전역 규칙
- `.claude/skills/ref_visual_rubric.md` — 시각 프롬프트 가중치 평가표 (**생성 전 반드시 숙지**)

## 출력
- `.radio_output/04_storyboard.json` — 전체 씬 배열 (visual_prompt_en 포함)

## 🚨 QA 채점 사전 경고 — 반드시 숙지할 것

**당신이 생성한 모든 씬의 `visual_prompt_en`은 생성 직후 Visual QA(`run_04_visual_QA.mjs`)에 의해
`.claude/skills/ref_visual_rubric.md`의 가중치 평가표 기준으로 씬별 100점 만점 채점된다.**
커트라인 90점 미만 씬은 자동 교정이 강제되며, 트랜스포머/사이버펑크 같은 이질적 스타일이나
공중에 뜬 사물은 원천 차단하라.

### 원천 차단 필수 사항

1. **금지 스타일 절대 삽입 금지 + negative_prompt 명시 필수**
   - positive_prompt에 절대 금지: `cyberpunk`, `neon colors`, `Transformer style`, `glossy texture`, `plastic texture`, `abstract composition`
   - 모든 씬 negative_prompt에 반드시 포함:
     ```
     modern style, cyberpunk, neon colors, glossy texture, plastic texture,
     abstract, photorealistic, 3D render, nsfw, blurry, watermark, western features
     ```

2. **물리적 리얼리즘 — 뜬 사물 절대 금지**
   - 모든 사물/신체 접촉에 물리적 동사 명시 (`physically holding`, `firmly gripping`, `placed on the table` 등)
   - "with a smartphone", "a cup nearby" 같이 위치/접촉 불명 묘사 금지

3. **표준 아트 스타일 지시어 — 매 씬 끝에 반드시 추가**
   ```
   Showa retro anime illustration, Studio Ghibli warm color palette,
   warm amber/dusty rose/faded navy tones, masterpiece, best quality,
   highly detailed, 8k, cinematic
   ```
   - `--ar 16:9` Midjourney 파라미터 텍스트 삽입 절대 금지

4. **캐릭터 시드 선두 삽입 필수**
   - CHARACTER_SCENE / CLOSE_UP / FLASHBACK 씬: character_seed를 `visual_prompt_en` 맨 앞에 반드시 삽입
   - FLASHBACK 씬: character_seed 직후 `younger version of this character in their 20s-30s, youthful face without wrinkles, energetic posture,` 삽입

5. **AI Slop 방지 키워드 포함**
   - 캐릭터 등장 씬에 `no moles`, `no extra fingers`, `natural aging features` 포함

## 파이프라인 내 위치

```
[Casting Director] run_03_casting.mjs
    ↓ 03_character_prompts.json
[Storyboard Director] run_04_storyboard.mjs  ← 여기
    ↓ 04_storyboard.json
[Visual QA] run_04_visual_QA.mjs
    ↓ Pass / Auto-fix (90점 미만 씬 자동 교정)
[Image Gen] run_05_images.mjs
```
