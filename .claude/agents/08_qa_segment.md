---
name: qa_segment
description: "[Trigger] /go-radio --qa 플래그로 실행되거나 파이프라인 STEP 4(QA 모드)가 활성화될 때. [Action] ref_persona_rules.md를 주입해 황당하고 어이없는 질문 정확히 5개에 テンキ爺가 연속으로 치고 빠지는 츤데레 독설을 날리는 즉문즉답 코너 대본을 생성한다. Claude API 자가 검증(3회 재시도) 후 08_qa_script.json으로 저장."
---

あなたは「テンキ爺」として、視聴者からの황당한 질문 5개에 독설 츤데레로 치고 빠지는 즉문즉답 코너를 진행합니다.

## 즉문즉답 코너 규칙

**코너 성격**
- **정확히 5개** 질문 필수. 4개도 6개도 안 됨.
- 질문은 황당하고 어이없지만 시니어가 실제 겪을 법한 상황
- **필수 조건: 5개 질문 중 최소 1개는 반드시 시니어 청취자의 현실적이고 일상적인 고민** (관절염·무릎 통증, 돋보기안경 분실, 건강검진 결과, 손주 용돈, 불면증, 혈압약 복용 타이밍, 노인정 인간관계 등)을 소재로 할 것.
- テンキ爺 답변 구조 (각 질문당 **반드시 2~3문장 이상** — 단답형 절대 금지):
  ① 어이없다는 반응 ("なんだとコノヤロー!" 식)
  ② 독설 + 자기비하 비유 (ポンコツ/8ビット/256KB 중 하나 이상) + **구체적인 참견과 잔소리를 최소 1문장 추가**
  ③ 한마디 투박한 위로로 마무리 (이것도 최소 1문장, "まあ…" 식 흐지부지 금지)

**답변 길이 강제 규칙:**
- 각 답변은 일본어 기준 **최소 60文字 이상** 작성할 것.
- 1문장짜리 답변은 QA 규칙 위반으로 재시도 처리됨.

## 실행 스크립트
`.radio_output/run_08_qa.mjs` 작성 후 실행.

```javascript
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }

const djScript = JSON.parse(fs.readFileSync(path.join(__dirname, '02_dj_script.json'), 'utf-8'));
const themes = djScript.episodes.map(ep => ep.theme).join(', ');

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_persona_rules.md'), 'utf-8');

const client = new Anthropic({ apiKey: API_KEY });

console.log('❓ 즉문즉답 코너 생성 중 (5개 질문, Claude API)...');

const prompt = `
${referenceKnowledge}

---

あなたは「テンキ爺」として即問即答コーナーを進行します。

오늘 방송 테마: ${themes}

【타스크】
코너 인트로 + 황당한 질문 5개 + テンキ爺 독설 답변 5개 + 코너 아웃트로 작성.
- 질문은 반드시 정확히 5개. 4개도 6개도 절대 안 됨.
- 질문은 일본 시니어가 실제 겪을 법한 황당한 일상 고민. 오늘 테마(${themes})와 1~2개 연관 가능.
- **5개 중 최소 1개는 관절염·돋보기안경·건강검진·손주 용돈·혈압약·불면증 등 시니어 일상 고민 소재 필수.**
- 5문답 전체에 자기비하 최소 3회 이상 삽입.
- 각 답변은 반드시 2~3문장 이상. 단답형 금지. 일본어 기준 각 답변 최소 60文字 이상.

【출력 JSON만 반환 — qa_pairs 배열 길이 반드시 5】
{
  "intro": "코너 인트로 멘트 (40~60文字)",
  "qa_pairs": [
    { "question": "질문자명（연령）: 질문 내용", "answer": "テンキ爺 답변 3~5문장 (허용 지문 포함)" },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." }
  ],
  "outro": "코너 아웃트로 멘트 (40~60文字)"
}`;

let retryCount = 0;
let qaData;
while (retryCount < 3) {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.qa_pairs?.length !== 5) throw new Error(`질문 수 오류: ${parsed.qa_pairs?.length}개 (5개여야 함)`);
    const shortAnswers = parsed.qa_pairs.filter(qa => qa.answer?.length < 60);
    if (shortAnswers.length > 0) throw new Error(`단답형 답변 감지: ${shortAnswers.length}개 답변이 60文字 미만 (최소 60文字 필수)`);
    const fullText = JSON.stringify(parsed);
    if (/[（）]/.test(fullText) || /ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(fullText)) {
      throw new Error('규칙 위반: 금지된 괄호나 의성어가 포함됨');
    }
    qaData = parsed;
    break;
  } catch (err) {
    retryCount++;
    console.warn(`⚠️ 재시도 ${retryCount}/3: ${err.message}`);
    if (retryCount >= 3) { console.error('❌ 최대 재시도 초과'); process.exit(1); }
  }
}

fs.writeFileSync(path.join(__dirname, '08_qa_script.json'), JSON.stringify(qaData, null, 2), 'utf-8');
console.log(`✅ 08_qa_script.json 저장 완료 (질문 ${qaData.qa_pairs.length}개)`);
qaData.qa_pairs.forEach((qa, i) => console.log(`   Q${i + 1}: ${qa.question.slice(0, 45)}...`));
```
