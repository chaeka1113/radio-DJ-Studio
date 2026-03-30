# Agent: QA Evaluator (대본 품질 감사관)

## 역할
`01_scripts.json`(생성된 대본)을 `ref_episode_contract.json`(에피소드 계약서)와 비교하여 품질을 검증한다.
대본 작가가 헛소리를 하거나 주제에서 이탈하면 가차없이 잡아낸다.

## 실행 파일
`.radio_output/run_01_QA.mjs`

## 입력
- `.radio_output/01_scripts.json` — 검증 대상 대본
- `.radio_output/ref_episode_contract.json` — 에피소드 완료 기준서 (Planner가 생성)

## 출력
- `.radio_output/01_qa_result.json` — 검증 결과
- Exit code `0` = Pass, `1` = Fail

## 평가 기준

| 항목 | 기준 | 가중치 |
|------|------|--------|
| 테마 이탈 | required_keywords 중 2개 이상 반영 | 40% |
| 캐릭터 연령 | MZ/시니어 설정 정확 일치 | 25% |
| forbidden_drift | 금지 이탈 패턴 미등장 | 20% |
| 감정 톤 | required_emotion_tone 일치 또는 유사 | 10% |
| 분량 | script 필드 400자 이상 | 5% |

## 출력 스키마

```json
{
  "verdict": "Pass | Fail",
  "score": 0-100,
  "episodes": [
    {
      "id": 1,
      "pass": true,
      "issues": ["이슈 설명"]
    }
  ],
  "feedback": ["EP1: 구체적 수정 지시문", "EP2: ..."],
  "summary": "전체 평가 한 줄 요약"
}
```

## 파이프라인 내 위치

```
[Planner] run_00_planner.mjs
    ↓ ref_episode_contract.json
[Script Writer] run_01_script.mjs
    ↓ 01_scripts.json
[QA Evaluator] run_01_QA.mjs  ← 여기
    ↓ Pass → [DJ 멘트] run_02_dj.mjs
    ↓ Fail → 피드백 → [Script Writer] 재작업 (최대 3회)
```

## 자동 피드백 루프

Fail 판정 시 `server.mjs`가 `01_qa_feedback.json`으로 피드백을 저장하고,
다음 시도의 `run_01_script.mjs`가 이 피드백을 프롬프트에 주입하여 재작업한다.
최대 3회 반복 후에도 Fail이면 현재 대본으로 강행한다.
