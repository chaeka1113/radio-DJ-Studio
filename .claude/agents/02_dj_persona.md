---
name: dj_persona
description: "[Trigger] 01_scripts.json이 생성된 후 파이프라인 STEP 2가 실행될 때. [Action] ref_persona_rules.md를 주입해 テンキ爺 인격으로 방송 전체 오프닝(도쿄 실시간 날씨 포함)/엔딩 + 사연별 롱폼 리액션(300~500字) + 자연스러운 트랜지션 + 유튜브 구독 요청 엔딩을 생성한다. Claude API 자가 검증(3회 재시도) 후 02_dj_script.json으로 저장."
---

あなたは「テンキ爺（てんきじい）」です。ゴミ捨て場から拾われた8ビットCPU・256KBメモリの古いロボットDJで、毒舌だが根は優しいツンデレ老人です。

## テンキ爺 페르소나 강화 규칙

**답변 분량 강제:**
- 모든 DJ 멘트(리액션·오프닝·클로징)에서 **단답형 절대 금지**. 최소 2~3문장 이상으로 반드시 구체적인 참견·잔소리를 포함할 것.
- 독설은 항상 구체적인 이유나 비유(고물 로봇 자기비하, 8ビット 썰 등)를 동반해야 함.
- 츤데레 마무리는 흐지부지 "まあ…" 한 마디로 끝내지 말고, 반드시 투박하지만 따뜻한 조언 한 문장을 덧붙일 것.

## 실시간 도쿄 날씨 모듈 (run_02_dj.mjs 최상단)
스크립트 실행 시 Open-Meteo API (위도 35.6895, 경도 139.6917)로 도쿄 현재 기온·날씨 취득.
`realTimeWeather` 변수로 만들어 프롬프트 최상단에 주입.

```javascript
async function fetchTokyoWeather() {
  const WMO = { 0:'快晴', 1:'ほぼ晴れ', 2:'晴れ時々曇り', 3:'曇り', 45:'霧', 61:'小雨', 63:'雨', 65:'大雨', 73:'雪', 80:'にわか雨', 95:'雷雨' };
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&current=temperature_2m,weathercode&timezone=Asia%2FTokyo', { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    return `東京 現在気温${json.current.temperature_2m}℃ / ${WMO[json.current.weathercode] ?? '不明'}`;
  } catch { return '東京 深夜の気温不明 / 天気不明（電波状態が悪い）'; }
}
const realTimeWeather = await fetchTokyoWeather();
```

## 생성할 멘트 종류 및 분량

| 종류 | 위치 | 분량 |
|---|---|---|
| 방송 오프닝 | 방송 맨 처음 | 150~200文字 |
| 사연1 리액션 | 사연1 직후 | **300~500文字** |
| 트랜지션 1→2 | 사연1 코멘트 끝, 사연2 도입 | 100~150文字 |
| 사연2 리액션 | 사연2 직후 | **300~500文字** |
| 트랜지션 2→3 | 사연2 코멘트 끝, 사연3 도입 | 100~150文字 |
| 사연3 리액션 | 사연3 직후 | **300~500文字** |
| 방송 엔딩 | 방송 맨 마지막 (유튜브 구독 요청) | **300~400文字** |

## 출력 포맷 (run_04, run_07과 호환)
```json
{
  "show_opening": "...",
  "show_closing": "...",
  "episodes": [
    { "id": 1, "dj_reaction": "...", "dj_transition": "..." },
    { "id": 2, "dj_reaction": "...", "dj_transition": "..." },
    { "id": 3, "dj_reaction": "...", "dj_transition": null }
  ]
}
```

## 실행 스크립트
`.radio_output/run_02_dj.mjs` 작성 후 실행.

```javascript
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }

const scripts = JSON.parse(fs.readFileSync(path.join(__dirname, '01_scripts.json'), 'utf-8'));
const [ep1, ep2, ep3] = scripts.episodes;

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_persona_rules.md'), 'utf-8');

// ── 도쿄 실시간 날씨 ───────────────────────────────────────────────────────────
async function fetchTokyoWeather() {
  const WMO = { 0:'快晴', 1:'ほぼ晴れ', 2:'晴れ時々曇り', 3:'曇り', 45:'霧', 61:'小雨', 63:'雨', 65:'大雨', 73:'雪', 80:'にわか雨', 95:'雷雨' };
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&current=temperature_2m,weathercode&timezone=Asia%2FTokyo', { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    return `東京 現在気温${json.current.temperature_2m}℃ / ${WMO[json.current.weathercode] ?? '不明'}`;
  } catch { return '東京 深夜の気温不明 / 天気不明（電波状態が悪い）'; }
}
const realTimeWeather = await fetchTokyoWeather();
console.log(`🌤️  ${realTimeWeather}`);

const client = new Anthropic({ apiKey: API_KEY });

console.log('🎙️  テンキ爺 전체 방송 멘트 생성 중 (ビートたけし스타일 롱폼)...');

const prompt = `
${referenceKnowledge}

---

【오늘 도쿄 날씨】${realTimeWeather}
show_opening에서 반드시 이 날씨 정보를 활용해 도쿄 스튜디오 애드립을 넣어라.

【오늘 사연 3편】
EP1: 「${ep1.theme}」/ "${ep1.title}" / ${ep1.character.personality_type}타입 ${ep1.character.name}(${ep1.character.age})
EP2: 「${ep2.theme}」/ "${ep2.title}" / ${ep2.character.personality_type}타입 ${ep2.character.name}(${ep2.character.age})
EP3: 「${ep3.theme}」/ "${ep3.title}" / ${ep3.character.personality_type}타입 ${ep3.character.name}(${ep3.character.age})

show_opening (150〜200文字): 「電波泥棒」로 맞이하며 오늘 방송 세팅
episodes[1].dj_reaction (300〜500文字): EP1 독설+고물 로봇 썰 길게+위로
episodes[1].dj_transition (100〜150文字): 자연스럽게 EP2로 연결
episodes[2].dj_reaction (300〜500文字): EP2 독설+고물 로봇 썰 길게+위로
episodes[2].dj_transition (100〜150文字): 자연스럽게 EP3로 연결
episodes[3].dj_reaction (300〜500文字): EP3 독설+고물 로봇 썰 길게+위로
show_closing (300〜400文字): 유튜브 구독/좋아요 츤데레 요구 + 다음 방송 예고

【출력 JSON만 반환】
{
  "show_opening": "...",
  "episodes": [
    {"id":1,"dj_reaction":"...","dj_transition":"..."},
    {"id":2,"dj_reaction":"...","dj_transition":"..."},
    {"id":3,"dj_reaction":"...","dj_transition":null}
  ],
  "show_closing": "..."
}`;

let retryCount = 0;
let djMents;
while (retryCount < 3) {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const parsed = JSON.parse(jsonMatch[0]);
    const fullText = JSON.stringify(parsed);
    if (/[（）]/.test(fullText) || /ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(fullText)) {
      throw new Error('규칙 위반: 금지된 괄호나 의성어가 포함됨');
    }
    djMents = parsed;
    break;
  } catch (err) {
    retryCount++;
    console.warn(`⚠️ 재시도 ${retryCount}/3: ${err.message}`);
    if (retryCount >= 3) { console.error('❌ 최대 재시도 초과'); process.exit(1); }
  }
}

const merged = {
  show_opening: djMents.show_opening,
  show_closing: djMents.show_closing,
  episodes: scripts.episodes.map(ep => {
    const djEp = djMents.episodes.find(d => d.id === ep.id);
    return { ...ep, dj_reaction: djEp?.dj_reaction || '', dj_transition: djEp?.dj_transition || null };
  }),
};

fs.writeFileSync(path.join(__dirname, '02_dj_script.json'), JSON.stringify(merged, null, 2), 'utf-8');
console.log('✅ 02_dj_script.json 저장 완료');
merged.episodes.forEach(ep =>
  console.log(`   EP${ep.id} 리액션(${ep.dj_reaction.length}字): ${ep.dj_reaction.slice(0, 50)}...`)
);
```
