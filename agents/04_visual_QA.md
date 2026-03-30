# Agent: Visual QA (시각 검증자)

## 역할
`04_storyboard.json`의 각 씬 `visual_prompt_en`이 `ref_character_sheet.json`에 명시된
캐릭터 외모·복장 요소를 **100% 정확히** 반영했는지 검증한다.
검은 스니커즈를 흰 운동화로 바꾸거나 청바지를 치마로 묘사하면 즉시 반려한다.

## 실행 방법
스토리보드 생성 직후 (`run_04_storyboard.mjs` 완료 후) 수동 또는 파이프라인에서 호출.

```bash
node .radio_output/run_04_visual_QA.mjs
```

> ✅ `run_04_visual_QA.mjs` 구현 완료 — 가중치 루브릭(ref_visual_rubric.md) 기반 Gemini 2.5 Flash 채점 + Auto-fix 루프.

## 입력
- `.radio_output/04_storyboard.json` — 검증 대상 이미지 프롬프트
- `.radio_output/ref_character_sheet.json` — 캐릭터 외모/복장 기준서 (Casting Director 생성)
- `.radio_output/03_character_prompts.json` — 원본 캐릭터 시드 프롬프트

## 출력
- `.radio_output/04_visual_qa_result.json` — 검증 결과
- Exit code `0` = Pass, `1` = Fail (반려)

## 가중치 평가표 (ref_visual_rubric.md 기반)

| 항목 | 배점 | 핵심 기준 |
|------|------|-----------|
| 캐릭터 일관성 & 시니어 네거티브 제약 | 40점 | AI Slop 방지 키워드 + 금지 스타일(cyberpunk 등) negative_prompt 명시 |
| 물리적 리얼리즘 | 30점 | 사물/신체 접촉에 물리적 동사 명시, 공중 부유 금지 |
| 아트 스타일 일관성 | 30점 | Showa retro anime / Studio Ghibli 지시어 완전 포함, Midjourney `--ar` 파라미터 금지 |

**커트라인: 90점**

### 허용 예외
- **FLASHBACK 씬**: 젊은 시절 modifier 적용 시 연령 특징 변경 허용
- **DJ_SHOT 씬**: テンキ爺 고정 외모로 대체 허용
- **순수 배경 씬** (character_seed 미포함 ESTABLISHING): 항목 1 만점 자동 부여

## 출력 스키마

```json
{
  "verdict": "Pass | Fail",
  "total_scenes": 24,
  "checked_scenes": 18,
  "failed_scenes": [
    {
      "scene_id": "EP1_SC3",
      "issues": [
        "Expected 'black sneakers' but found 'white shoes'",
        "Missing character trait: wrinkled face"
      ],
      "original_prompt": "...",
      "corrected_prompt": "..."
    }
  ],
  "feedback": ["EP1_SC3: 신발 색상 오류 — 'black sneakers'로 수정 필요"],
  "summary": "18씬 검증, 1씬 반려"
}
```

## 자동 수정 (Auto-Correction)

`verdict = "Fail"` 시, `corrected_prompt` 필드를 기반으로
`04_storyboard.json`의 해당 씬 `visual_prompt_en`을 **자동 수정**하고 스토리보드를 재저장한다.
이후 이미지 생성 단계(`run_05_images.mjs`)로 넘어간다.

## 파이프라인 내 위치

```
[Storyboard] run_04_storyboard.mjs
    ↓ 04_storyboard.json
[Visual QA] run_04_visual_QA.mjs  ← 여기
    ↓ Pass → [Image Gen] run_05_images.mjs
    ↓ Fail → 자동 수정 → [Image Gen] run_05_images.mjs
```
