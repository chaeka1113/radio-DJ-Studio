import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs, updateStage } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

// PATCH 4: --qna 플래그 파싱
const includeQna = process.argv.includes('--qna');

const API_KEY = requireEnv('ANTHROPIC_API_KEY');
const client = new Anthropic({ apiKey: API_KEY });

const scripts = JSON.parse(fs.readFileSync(P.scripts, 'utf-8'));
const scriptEpisodes = scripts.episodes ?? [];
if (scriptEpisodes.length < 3) {
  console.error(`❌ 01_scripts.json에 에피소드 ${scriptEpisodes.length}개뿐 — 최소 3개 필요`);
  process.exit(1);
}
const [ep1, ep2, ep3] = scriptEpisodes;

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(P.refPersona, 'utf-8');

// ── 실시간 도쿄 날씨 ───────────────────────────────────────────────────────────
async function fetchTokyoWeather() {
  const WMO = {
    0: '快晴', 1: 'ほぼ晴れ', 2: '晴れ時々曇り', 3: '曇り',
    45: '霧', 48: '着氷性の霧',
    51: '霧雨（弱）', 53: '霧雨', 55: '霧雨（強）',
    61: '小雨', 63: '雨', 65: '大雨',
    71: '小雪', 73: '雪', 75: '大雪', 77: '霰',
    80: 'にわか雨（弱）', 81: 'にわか雨', 82: 'にわか雨（激しい）',
    85: '雪のにわか降り', 86: '雪のにわか降り（強）',
    95: '雷雨', 96: '雹を伴う雷雨', 99: '激しい雹を伴う雷雨',
  };
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&current=temperature_2m,weathercode&timezone=Asia%2FTokyo';
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    const temp = json.current?.temperature_2m;
    const code = json.current?.weathercode;
    return `東京 現在気温${temp}℃ / ${WMO[code] ?? '不明'}`;
  } catch (err) {
    console.warn(`   ⚠️  날씨 API 실패 (${err.message}) → 기본값 사용`);
    return '東京 深夜の気温不明 / 天気不明（電波状態が悪い）';
  }
}

console.log('🌤  도쿄 실시간 날씨 취득 중...');
const realTimeWeather = await fetchTokyoWeather();
console.log(`   📡 ${realTimeWeather}`);

// PATCH 4: QNA 지시문
const QNA_INSTRUCTION = includeQna ? `

【짤막 Q&A 코너 추가 지시】
3개 에피소드 멘트 이후, "짤막 Q&A" 코너를 추가하라.
- 리스너의 황당/웃긴 질문 3개 + テンキ爺의 독설 한 마디 답변 (각 60자 이내)
- JSON 출력에 다음 필드를 추가:
  "qa_segment": {
    "intro": "Q&A 코너 인트로 멘트 (テンキ爺 스타일)",
    "pairs": [
      {"q": "리스너 질문1", "a": "テンキ爺 독설 답변1"},
      {"q": "리스너 질문2", "a": "テンキ爺 독설 답변2"},
      {"q": "리스너 질문3", "a": "テンキ爺 독설 답변3"}
    ]
  }
- --qna 플래그가 활성화된 경우에만 이 필드를 포함한다.` : '';

const DJ_MODEL = 'claude-sonnet-4-5';

console.log('🎙️  テンキ爺 전체 방송 멘트 생성 중 (ビートたけし스타일 롱폼, Claude API)...');

const prompt = `
${referenceKnowledge}

---

# 🚨 DJ 멘트 필수 규칙

DJ 멘트에서 [溜息][間] 등 일본어 행동 지문과 괄호 사용은 절대 금지.
「ワシ」1인칭·「電波泥棒」호칭·고물 로봇 비유를 반드시 포함할 것.
ElevenLabs V3 Audio Tag([sighs] 등)는 앞뒤 공백 필수 — 일본어에 직접 붙이지 말 것.

---

【오늘 도쿄 날씨】${realTimeWeather}
show_opening에서 반드시 이 날씨 정보를 활용해 도쿄 스튜디오 애드립을 넣어라.

【오늘 사연 3편】
EP1: 테마「${ep1.theme}」/ "${ep1.title}" / ${ep1.character.personality_type}타입 ${ep1.character.name}(${ep1.character.age})
EP2: 테마「${ep2.theme}」/ "${ep2.title}" / ${ep2.character.personality_type}타입 ${ep2.character.name}(${ep2.character.age})
EP3: 테마「${ep3.theme}」/ "${ep3.title}" / ${ep3.character.personality_type}타입 ${ep3.character.name}(${ep3.character.age})

【생성할 멘트 & 분량】
▶ show_opening (150〜200文字): 「電波泥棒ども」로 맞이하며 도쿄 날씨 애드립 포함, 오늘 밤 방송 세팅
▶ episodes[1].dj_reaction (300〜500文字): EP1 독설+고물 로봇 썰 길게+투박한 위로
▶ episodes[1].dj_transition (100〜150文字): 자연스럽게 EP2로 연결
▶ episodes[2].dj_reaction (300〜500文字): EP2 독설+고물 로봇 썰 길게+투박한 위로
▶ episodes[2].dj_transition (100〜150文字): 자연스럽게 EP3로 연결
▶ episodes[3].dj_reaction (300〜500文字): EP3 독설+고물 로봇 썰 길게+투박한 위로
▶ show_closing (300〜400文字): 유튜브 구독/좋아요 츤데레 요구 + 다음 방송 예고
${QNA_INSTRUCTION}

【출력 JSON만 반환】
{
  "show_opening": "...",
  "episodes": [
    {"id":1,"dj_reaction":"...","dj_transition":"..."},
    {"id":2,"dj_reaction":"...","dj_transition":"..."},
    {"id":3,"dj_reaction":"...","dj_transition":null}
  ],
  "show_closing": "..."${includeQna ? `,
  "qa_segment": {
    "intro": "...",
    "pairs": [
      {"q":"...","a":"..."},
      {"q":"...","a":"..."},
      {"q":"...","a":"..."}
    ]
  }` : ''}
}`;

let retryCount = 0;
let djMents;
while (retryCount < 3) {
  try {
    const message = await client.messages.create({
      model: DJ_MODEL,
      max_tokens: 8192,
      temperature: 0.8,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content[0]?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const parsed = JSON.parse(jsonMatch[0]);
    // DJ 멘트는 （）자연 사용 허용, 로봇 의성어만 차단
    const djTexts = [
      parsed.show_opening || '',
      parsed.show_closing || '',
      ...(parsed.episodes || []).flatMap(ep => [ep.dj_reaction || '', ep.dj_transition || '']),
    ].join('\n');
    if (/ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(djTexts)) {
      throw new Error('규칙 위반: DJ 멘트에 금지된 의성어 포함됨');
    }
    djMents = parsed;
    break;
  } catch (err) {
    const msg = err.message ?? '';
    // 일일 한도(RPD) 초과 — 재시도 무의미, 즉시 중단
    if (msg.includes('daily') || msg.includes('PerDay') || msg.includes('credit balance') ||
        (err.status === 529) || (err.status === 529)) {
      console.error(`❌ Claude API 일일 한도 또는 크레딧 부족 — 즉시 중단`);
      console.error(`   └ ${msg.slice(0, 200)}`);
      process.exit(1);
    }
    retryCount++;
    console.warn(`⚠️ 재시도 ${retryCount}/3: ${msg.slice(0, 200)}`);
    if (retryCount >= 3) { console.error('❌ 최대 재시도 초과'); process.exit(1); }
    await new Promise(r => setTimeout(r, 3000 * retryCount));
  }
}

// ── Real Fallback: LLM이 필드를 누락했을 때 テンキ爺 기본 대사 주입 ──────────
djMents.show_opening = djMents.show_opening ||
  '[ガラガラ] おう、電波泥棒ども！今夜もワシのポンコツ電波を盗みに来やがったか。まあいい、せいぜい楽しんでいけや。';
djMents.show_closing = djMents.show_closing ||
  '[溜息] ふん、今夜はここまでだ。電波泥棒ども、また次回な！チャンネル登録と高評価、忘れんなよコノヤロー！';
(djMents.episodes || []).forEach(ep => {
  ep.dj_reaction = ep.dj_reaction || `[ぼそっと] EP${ep.id}か。まあ、それなりに生きてるじゃないか。`;
});

const merged = {
  show_opening: djMents.show_opening,
  show_closing: djMents.show_closing,
  tokyo_weather: realTimeWeather,
  episodes: scriptEpisodes.map(ep => {
    const djEp = djMents.episodes.find(d => d.id === ep.id);
    return {
      ...ep,
      dj_reaction: djEp?.dj_reaction || '',
      dj_transition: djEp?.dj_transition || null,
    };
  }),
};

// PATCH 4: qa_segment가 있으면 08_qa_script.json 저장
if (includeQna && djMents.qa_segment) {
  const qaOut = {
    intro: djMents.qa_segment.intro || '',
    qa_pairs: (djMents.qa_segment.pairs || []).map(p => ({ question: p.q, answer: p.a })),
    outro: merged.show_closing,
  };
  fs.writeFileSync(P.qaScript, JSON.stringify(qaOut, null, 2), 'utf-8');
  console.log('✅ 08_qa_script.json 저장 완료 (Q&A 코너)');
}

fs.writeFileSync(P.djScript, JSON.stringify(merged, null, 2), 'utf-8');

console.log('✅ 02_dj_script.json 저장 완료');
console.log(`   🌤  날씨: ${realTimeWeather}`);
console.log(`   오프닝: ${merged.show_opening.slice(0, 50)}...`);
merged.episodes.forEach(ep => {
  console.log(`   EP${ep.id} 리액션(${ep.dj_reaction.length}字): ${ep.dj_reaction.slice(0, 50)}...`);
  if (ep.dj_transition) console.log(`   └→ 트랜지션: ${ep.dj_transition.slice(0, 40)}...`);
});
const closing = merged.show_closing ?? '';
console.log(`   엔딩(${closing.length}字): ${closing.slice(0, 50)}...`);
