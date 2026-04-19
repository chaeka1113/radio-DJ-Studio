/**
 * run_02_dj.mjs  — テンキ爺 DJ 멘트 생성
 * 엔진: Gemini 2.5 Pro (thinking budget 활성화)
 * 특징: 사연 전문 기반 유기적 반응 / villain·MZ 전용 리액션 / 최근 3EP 어휘 제한
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs, updateStage } from './lib/paths.mjs';
import { validateDjScript } from './lib/validate.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

const includeQna = process.argv.includes('--qna');
const GEMINI_KEY = requireEnv('GEMINI_API_KEY');
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOCAB_LOG_PATH = path.join(__dirname, 'ref_dj_vocab_log.json');

// ── 입력 파일 로드 ────────────────────────────────────────────────────────────
const scripts  = JSON.parse(fs.readFileSync(P.scripts, 'utf-8'));
const episodes = scripts.episodes ?? [];
if (episodes.length < 3) {
  console.error(`❌ 01_scripts.json 에피소드 ${episodes.length}개 — 최소 3개 필요`);
  process.exit(1);
}

// 에피소드 계약서 (villain / mz 플래그)
let contract = null;
if (fs.existsSync(P.episodeContract)) {
  contract = JSON.parse(fs.readFileSync(P.episodeContract, 'utf-8'));
}

// ref_persona_rules.md 로드
const personaRules = fs.readFileSync(P.refPersona, 'utf-8');

// 어휘 로그 (최근 3EP 금지 표현)
let vocabLog = { recent_eps: [] };
if (fs.existsSync(VOCAB_LOG_PATH)) {
  try { vocabLog = JSON.parse(fs.readFileSync(VOCAB_LOG_PATH, 'utf-8')); } catch (_) {}
}
const recentExprs = vocabLog.recent_eps
  .slice(-3)
  .flatMap(ep => ep.expressions ?? [])
  .filter((v, i, a) => a.indexOf(v) === i); // 중복 제거

// ── 도쿄 실시간 날씨 ─────────────────────────────────────────────────────────
async function fetchTokyoWeather() {
  const WMO = {
    0:'快晴',1:'ほぼ晴れ',2:'晴れ時々曇り',3:'曇り',45:'霧',48:'着氷性の霧',
    51:'霧雨（弱）',53:'霧雨',55:'霧雨（強）',61:'小雨',63:'雨',65:'大雨',
    71:'小雪',73:'雪',75:'大雪',80:'にわか雨',95:'雷雨',
  };
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&current=temperature_2m,weathercode&timezone=Asia%2FTokyo';
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    return `東京 現在気温${json.current?.temperature_2m}℃ / ${WMO[json.current?.weathercode] ?? '不明'}`;
  } catch (err) {
    console.warn(`   ⚠️  날씨 API 실패 → 기본값`);
    return '東京 深夜の気温不明 / 電波状態が悪い';
  }
}

console.log('🌤  도쿄 실시간 날씨 취득 중...');
const realTimeWeather = await fetchTokyoWeather();
console.log(`   📡 ${realTimeWeather}`);

// ── 에피소드별 컨텍스트 빌드 ─────────────────────────────────────────────────
function buildEpContext(ep) {
  const contractEp = contract?.episodes?.find(c => c.id === ep.id);
  const isVillain   = contractEp?.villain_required ?? false;
  const isMZ        = (contract?.mz_episode_id === ep.id) || (contract?.mz_mode && ep.id === 1);
  const age         = ep.character?.age ?? '';
  const ageNum      = parseInt(String(age).replace(/[^0-9]/g, '')) || 0;
  const isMZByAge   = ageNum > 0 && ageNum <= 39;

  return {
    id:       ep.id,
    theme:    ep.theme,
    title:    ep.title,
    name:     ep.character?.name ?? '',
    age:      age,
    script:   ep.script ?? '',        // 사연 전문
    isVillain,
    isMZ:     isMZ || isMZByAge,
  };
}

const epContexts = episodes.slice(0, 3).map(buildEpContext);

// ── QA 지시문 ─────────────────────────────────────────────────────────────────
const QNA_INSTRUCTION = includeQna ? `

【Q&Aコーナー】
3本のエピソードメントの後に、リスナーからのQ&Aコーナーを追加せよ。
リスナーからのバカバカしい・あり得ない質問3つ + テンキ爺の毒舌一言回答（各60文字以内）。
質問・回答はすべて日本語のみ。韓国語・英語は一切混入禁止。
JSONに追加:
"qa_segment": {
  "intro": "Q&Aコーナーのイントロメント（日本語）",
  "pairs": [
    {"q":"질문1（日本語）","a":"답변1（日本語）"},
    {"q":"질문2（日本語）","a":"답변2（日本語）"},
    {"q":"질문3（日本語）","a":"답변3（日本語）"}
  ]
}` : '';

// ── 금지 표현 목록 ────────────────────────────────────────────────────────────
const forbiddenBlock = recentExprs.length > 0
  ? `\n【이번 EP 사용 금지 표현 — 최근 3EP 중복 방지】\n${recentExprs.map(e => `・${e}`).join('\n')}\n위 표현은 이번 EP에서 사용하지 말 것. ただし ポンコツ/ガラクタ/バカ野郎 등 핵심 캐릭터 어휘는 예외.\n`
  : '';

// ── 에피소드별 특수 이벤트 지시 ───────────────────────────────────────────────
function buildSpecialInstruction(ctx) {
  const lines = [];
  if (ctx.isMZ) {
    lines.push(`⚡ EP${ctx.id} [MZ 이벤트]: 사연자 ${ctx.name}(${ctx.age})는 10~30대다. DJ 리액션 첫 마디에 반드시 「이 고철 라디오를 어떻게 찾아 들었냐」류의 당혹+신기함 전용 오프너를 넣어라. 매번 다르게 창작할 것.`);
  }
  if (ctx.isVillain) {
    lines.push(`⚡ EP${ctx.id} [빌런 이벤트]: 사연 전문을 읽고 판단하라 —`);
    lines.push(`  - 사연자가 피해자인 경우: 빌런을 향해 직격탄을 날리고, 사연자에게는 츤데레 위로.`);
    lines.push(`  - 사연자 본인이 빌런(가해자)인 경우: 위로 없음. 팩트 직격탄만. 정신차리라고 할 것.`);
  }
  return lines.join('\n');
}

const specialInstructions = epContexts.map(buildSpecialInstruction).filter(Boolean).join('\n');

// ── System Instruction (페르소나 고정) ───────────────────────────────────────
const SYSTEM_INSTRUCTION = `${personaRules}

---
あなたはテンキ爺（てんきじい）だ。上記のペルソナルールに従い、사연에 유기적으로 반응하라.
사연 전문을 반드시 읽고, 구체적인 디테일(이름·나이·사건)을 직접 언급하며 반응할 것.
매 EP마다 다른 흐름, 다른 감정 온도로 반응하라 — 공식처럼 반복하지 말 것.`;

// ── User 메시지 (동적 컨텍스트) ──────────────────────────────────────────────
const userMessage = `
【오늘 도쿄 날씨】${realTimeWeather}
show_opening에서 이 날씨 정보를 활용해 도쿄 스튜디오 애드립을 넣어라.
${forbiddenBlock}
${specialInstructions ? `【특수 이벤트 지시】\n${specialInstructions}\n` : ''}
【오늘 사연 3편 전문】

▶ EP1: 「${epContexts[0].theme}」/ "${epContexts[0].title}"
사연자: ${epContexts[0].name}(${epContexts[0].age})
───────────────────────
${epContexts[0].script}
───────────────────────

▶ EP2: 「${epContexts[1].theme}」/ "${epContexts[1].title}"
사연자: ${epContexts[1].name}(${epContexts[1].age})
───────────────────────
${epContexts[1].script}
───────────────────────

▶ EP3: 「${epContexts[2].theme}」/ "${epContexts[2].title}"
사연자: ${epContexts[2].name}(${epContexts[2].age})
───────────────────────
${epContexts[2].script}
───────────────────────

【생성할 멘트 & 분량】
▶ show_opening (150〜200文字): 「電波泥棒ども」로 시작, 도쿄 날씨 + 오늘 밤 예고
▶ episodes[1].dj_reaction (350〜500文字): 사연 구체적 디테일 직접 언급하며 반응
▶ episodes[1].dj_transition (80〜130文字): 자연스럽게 EP2 연결
▶ episodes[2].dj_reaction (350〜500文字): 위와 동일
▶ episodes[2].dj_transition (80〜130文字): EP3 연결
▶ episodes[3].dj_reaction (350〜500文字): 위와 동일
▶ show_closing (250〜350文字): 유튜브 구독 츤데레 요구 + 다음 방송 예고
${QNA_INSTRUCTION}

【출력: JSON만 반환, 설명 없음】
{
  "show_opening": "...",
  "episodes": [
    {"id":1,"dj_reaction":"...","dj_transition":"..."},
    {"id":2,"dj_reaction":"...","dj_transition":"..."},
    {"id":3,"dj_reaction":"...","dj_transition":null}
  ],
  "show_closing": "...",
  "used_expressions": ["이번 EP에서 사용한 특징적 표현 5〜10개 (어휘 로그용)"]${includeQna ? `,
  "qa_segment": {
    "intro": "...",
    "pairs": [
      {"q":"...","a":"..."},
      {"q":"...","a":"..."},
      {"q":"...","a":"..."}
    ]
  }` : ''}
}`;

// ── 페르소나 규칙 검증 함수 ───────────────────────────────────────────────────
function validateDjMents(parsed) {
  const violations = [];

  const opening   = parsed.show_opening  ?? '';
  const closing   = parsed.show_closing  ?? '';
  const episodes  = parsed.episodes      ?? [];
  const reactions   = episodes.map(e => e.dj_reaction  ?? '');
  const transitions = episodes.slice(0, 2).map(e => e.dj_transition ?? '');
  const allText   = [opening, closing, ...reactions, ...transitions].join('\n');

  // ── 분량 체크 ────────────────────────────────────────────────────────────────
  if (opening.length < 150 || opening.length > 200)
    violations.push(`show_opening 분량 오류: ${opening.length}字 (150~200字 필요)`);
  if (closing.length < 300 || closing.length > 400)
    violations.push(`show_closing 분량 오류: ${closing.length}字 (300~400字 필요)`);
  reactions.forEach((r, i) => {
    if (r.length < 300 || r.length > 500)
      violations.push(`EP${i+1} dj_reaction 분량 오류: ${r.length}字 (300~500字 필요)`);
  });
  transitions.forEach((t, i) => {
    if (t.length < 100 || t.length > 150)
      violations.push(`EP${i+1} dj_transition 분량 오류: ${t.length}字 (100~150字 필요)`);
  });

  // ── 금지 패턴 체크 ───────────────────────────────────────────────────────────
  if (/ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(allText))
    violations.push('금지 의성어 포함: ジジジ/ガガッ/ブーン 등');
  if (/\[[ぁ-ん一-龯ァ-ン]{1,6}\]/.test(allText))
    violations.push('일본어 대괄호 지문 포함: [溜息][間] 등 → 삭제 또는 [sighs]로 교체');
  if (/（[^）]{1,20}）/.test(allText))
    violations.push('일본어 괄호 행동묘사 포함: （ため息をつく）류 → 완전 삭제');
  if (/<break\s/.test(allText))
    violations.push('SSML 태그 포함: <break time=.../> → 완전 삭제');
  if (/ワシも若い頃|昔はよかった|あの頃を思い出す/.test(allText))
    violations.push('인간 회상체 금지: ワシも若い頃は〜 등 → 기계 시점 비유로 교체');
  if (/次回は|来週は|次の放送では|次のエピソード/.test(allText))
    violations.push('次回予告 금지: 次回は〜テーマ 등 → 열린 마무리로 교체');
  if (/\b(私|僕|俺)\b/.test(allText))
    violations.push('1인칭 오류: 私/僕/俺 사용 → ワシ로 통일');

  return violations;
}

// ── Gemini 2.5 Pro 호출 ───────────────────────────────────────────────────────
console.log('🎙️  テンキ爺 DJ 멘트 생성 중 (Gemini 2.5 Pro + thinking)...');

let djMents;
let retryCount = 0;
let retryFeedback = '';

while (retryCount < 3) {
  try {
    const retryPrefix = retryFeedback
      ? `🚨 이전 생성에서 아래 규칙 위반이 발견됐습니다. 반드시 수정하여 재생성하세요:\n${retryFeedback}\n\n`
      : '';

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      systemInstruction: SYSTEM_INSTRUCTION,
      contents: [{ role: 'user', parts: [{ text: retryPrefix + userMessage }] }],
      config: {
        temperature:   1.0,
        maxOutputTokens: 16384,
        thinkingConfig: { thinkingBudget: 10000 },
      },
    });

    const text = result.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const parsed = JSON.parse(jsonMatch[0]);

    const violations = validateDjMents(parsed);
    if (violations.length > 0) {
      retryFeedback = violations.map((v, i) => `${i+1}. ${v}`).join('\n');
      throw new Error(`페르소나 규칙 위반 ${violations.length}건:\n${retryFeedback}`);
    }

    djMents = parsed;
    if (retryCount > 0) console.log(`   ✅ ${retryCount}회 재시도 후 통과`);
    break;
  } catch (err) {
    retryCount++;
    console.warn(`⚠️  재시도 ${retryCount}/3: ${err.message?.slice(0, 200)}`);
    if (retryCount >= 3) { console.error('❌ 최대 재시도 초과'); process.exit(1); }
    await new Promise(r => setTimeout(r, 4000 * retryCount));
  }
}

// ── 어휘 로그 업데이트 ────────────────────────────────────────────────────────
const usedExpressions = djMents.used_expressions ?? [];
if (usedExpressions.length > 0) {
  vocabLog.recent_eps.push({ ep_id: epId, generated_at: new Date().toISOString(), expressions: usedExpressions });
  if (vocabLog.recent_eps.length > 3) vocabLog.recent_eps.shift(); // 최근 3EP만 유지
  fs.writeFileSync(VOCAB_LOG_PATH, JSON.stringify(vocabLog, null, 2), 'utf-8');
  console.log(`📝 어휘 로그 업데이트 (${usedExpressions.length}개 표현 기록)`);
}

// ── 결과 조립 ────────────────────────────────────────────────────────────────
djMents.show_opening  = djMents.show_opening  || 'おう、電波泥棒ども！今夜もワシのポンコツ電波を盗みに来やがったか。';
djMents.show_closing  = djMents.show_closing  || 'ふん、今夜はここまでだ。また次回な、コノヤロー！';
(djMents.episodes ?? []).forEach(ep => {
  ep.dj_reaction = ep.dj_reaction || `EP${ep.id}か... まあ、それなりに生きてるじゃないか。`;
});

const merged = {
  show_opening:   djMents.show_opening,
  show_closing:   djMents.show_closing,
  tokyo_weather:  realTimeWeather,
  episodes: episodes.map(ep => {
    const djEp = (djMents.episodes ?? []).find(d => d.id === ep.id);
    return { ...ep, dj_reaction: djEp?.dj_reaction || '', dj_transition: djEp?.dj_transition || null };
  }),
};

// QA 저장
if (includeQna && djMents.qa_segment) {
  const qaOut = {
    intro:    djMents.qa_segment.intro || '',
    qa_pairs: (djMents.qa_segment.pairs || []).map(p => ({ question: p.q, answer: p.a })),
    outro:    merged.show_closing,
  };
  fs.writeFileSync(P.qaScript, JSON.stringify(qaOut, null, 2), 'utf-8');
  console.log('✅ 08_qa_script.json 저장 완료');
}

fs.writeFileSync(P.djScript, JSON.stringify(merged, null, 2), 'utf-8');
validateDjScript(merged);
updateStage(epId, 'dj_script');

console.log('✅ 02_dj_script.json 저장 완료');
console.log(`   🌤  날씨: ${realTimeWeather}`);
console.log(`   오프닝: ${merged.show_opening.slice(0, 60)}...`);
merged.episodes.forEach(ep => {
  const ctx = epContexts.find(c => c.id === ep.id);
  const tags = [ctx?.isMZ ? '[MZ]' : '', ctx?.isVillain ? '[빌런]' : ''].filter(Boolean).join(' ');
  console.log(`   EP${ep.id}${tags ? ' ' + tags : ''} 리액션(${ep.dj_reaction.length}字): ${ep.dj_reaction.slice(0, 60)}...`);
});
console.log(`   엔딩(${merged.show_closing.length}字): ${merged.show_closing.slice(0, 60)}...`);
