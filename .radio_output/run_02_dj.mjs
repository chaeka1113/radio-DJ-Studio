/**
 * run_02_dj.mjs  — テンキ爺 DJ 멘트 생성
 * 엔진: Gemini 2.5 Pro (thinking budget 활성화)
 * 구조: EP별 dj_reaction 3회 개별 호출 → show_opening/closing 1회 호출 → 병합
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

const GEMINI_KEY = requireEnv('GEMINI_API_KEY');
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const VOCAB_LOG_PATH = path.join(__dirname, 'ref_dj_vocab_log.json');

// ── 입력 파일 로드 ────────────────────────────────────────────────────────────
const scripts  = JSON.parse(fs.readFileSync(P.scripts, 'utf-8'));
const episodes = scripts.episodes ?? [];
if (episodes.length < 3) {
  console.error(`❌ 01_scripts.json 에피소드 ${episodes.length}개 — 최소 3개 필요`);
  process.exit(1);
}

let contract = null;
if (fs.existsSync(P.epContract)) {
  contract = JSON.parse(fs.readFileSync(P.epContract, 'utf-8'));
}

const personaRules = fs.readFileSync(P.refPersona, 'utf-8');

let vocabLog = { recent_eps: [] };
if (fs.existsSync(VOCAB_LOG_PATH)) {
  try { vocabLog = JSON.parse(fs.readFileSync(VOCAB_LOG_PATH, 'utf-8')); } catch (_) {}
}
const recentExprs = vocabLog.recent_eps
  .slice(-3)
  .flatMap(ep => ep.expressions ?? [])
  .filter((v, i, a) => a.indexOf(v) === i);

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
  } catch {
    console.warn('   ⚠️  날씨 API 실패 → 기본값');
    return '東京 深夜の気温不明 / 電波状態が悪い';
  }
}

console.log('🌤  도쿄 실시간 날씨 취득 중...');
const realTimeWeather = await fetchTokyoWeather();
console.log(`   📡 ${realTimeWeather}`);

// ── 에피소드 컨텍스트 빌드 ────────────────────────────────────────────────────
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
    age,
    script:   ep.script ?? '',
    isVillain,
    isMZ:     isMZ || isMZByAge,
  };
}

const epContexts = episodes.slice(0, 3).map(buildEpContext);

// ── 공통 블록 ─────────────────────────────────────────────────────────────────
const forbiddenBlock = recentExprs.length > 0
  ? `\n【이번 EP 사용 금지 표현 — 최근 3EP 중복 방지】\n${recentExprs.map(e => `・${e}`).join('\n')}\n위 표현은 이번 EP에서 사용하지 말 것. ただし ポンコツ/ガラクタ/バカ野郎 등 핵심 캐릭터 어휘는 예외.\n`
  : '';

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

// ── Gemini 공통 설정 ──────────────────────────────────────────────────────────
const GEMINI_CONFIG = {
  temperature:     1.0,
  maxOutputTokens: 8192,
  thinkingConfig:  { thinkingBudget: 8000 },
};

// ── 재시도 래퍼 ───────────────────────────────────────────────────────────────
async function withRetry(fn, label, maxRetry = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️  ${label} 재시도 ${attempt + 1}/${maxRetry}: ${err.message?.slice(0, 120)}`);
      if (attempt < maxRetry - 1) {
        const is503 = err.status === 503 || err.message?.includes('503') || err.message?.includes('UNAVAILABLE');
        const delay = is503 ? [30000, 60000, 120000][attempt] ?? 120000 : 4000 * (attempt + 1);
        console.log(`⏳ ${Math.round(delay / 1000)}초 후 재시도...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ── 검증: EP별 dj_reaction ───────────────────────────────────────────────────
function validateEpReaction(parsed, ctx) {
  const lengthViolations = [];
  const ruleViolations   = [];
  const reaction   = parsed.dj_reaction   ?? '';
  const transition = parsed.dj_transition ?? '';
  const allText    = reaction + '\n' + transition;

  if (reaction.length < 500 || reaction.length > 700)
    lengthViolations.push(`dj_reaction ${reaction.length}字 (허용: 500~700字)`);
  if (ctx.id < 3 && transition) {
    if (transition.length < 80 || transition.length > 130)
      lengthViolations.push(`dj_transition ${transition.length}字 (허용: 80~130字)`);
  }

  if (/ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(allText))
    ruleViolations.push('금지 의성어 포함: ジジジ/ガガッ/ブーン 등');
  if (/\[[ぁ-ん一-龯ァ-ン]{1,6}\]/.test(allText))
    ruleViolations.push('일본어 대괄호 지문 포함: [溜息][間] 등 → [sighs]로 교체');
  if (/（[^）]{1,20}）/.test(allText))
    ruleViolations.push('일본어 괄호 행동묘사 포함: （ため息をつく）류 → 완전 삭제');
  if (/<break\s/.test(allText))
    ruleViolations.push('SSML 태그 포함: <break time=.../> → 완전 삭제');
  if (/ワシも若い頃|昔はよかった|あの頃を思い出す/.test(allText))
    ruleViolations.push('인간 회상체 금지: ワシも若い頃は〜 → 기계 시점 비유로 교체');
  if (/次回は|来週は|次の放送では|次のエピソード/.test(allText))
    ruleViolations.push('次回予告 금지: 次回は〜テーマ 등 → 열린 마무리로 교체');
  if (/\b(私|僕|俺)\b/.test(allText))
    ruleViolations.push('1인칭 오류: 私/僕/俺 사용 → ワシ로 통일');

  return { lengthViolations, ruleViolations };
}

// ── 검증: show_opening + show_closing ───────────────────────────────────────
function validateOpeningClosing(parsed) {
  const lengthViolations = [];
  const ruleViolations   = [];
  const opening = parsed.show_opening ?? '';
  const closing = parsed.show_closing ?? '';
  const allText = opening + '\n' + closing;

  if (opening.length < 150 || opening.length > 200)
    lengthViolations.push(`show_opening ${opening.length}字 (허용: 150~200字)`);
  if (closing.length < 400 || closing.length > 550)
    lengthViolations.push(`show_closing ${closing.length}字 (허용: 400~550字)`);

  if (/ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(allText))
    ruleViolations.push('금지 의성어 포함');
  if (/\[[ぁ-ん一-龯ァ-ン]{1,6}\]/.test(allText))
    ruleViolations.push('일본어 대괄호 지문 포함');
  if (/（[^）]{1,20}）/.test(allText))
    ruleViolations.push('일본어 괄호 행동묘사 포함');
  if (/<break\s/.test(allText))
    ruleViolations.push('SSML 태그 포함');
  if (/次回は|来週は|次の放送では|次のエピソード/.test(allText))
    ruleViolations.push('次回予告 금지');
  if (/\b(私|僕|俺)\b/.test(allText))
    ruleViolations.push('1인칭 오류: 私/僕/俺 → ワシ');

  return { lengthViolations, ruleViolations };
}

// ── 호출 1~3: EP별 dj_reaction 개별 생성 ─────────────────────────────────────
async function generateEpReaction(ctx) {
  const specialInstruction = buildSpecialInstruction(ctx);
  const isLastEp = ctx.id === 3;

  const SYSTEM = `${personaRules}

---
あなたはテンキ爺だ。以下の一つの投稿に集中して反応しろ。
페르소나 규칙에 따라 유기적으로 반응하라.
---`;

  const USER = `【오늘 도쿄 날씨】${realTimeWeather}
${forbiddenBlock}${specialInstruction ? `【특수 이벤트 지시】\n${specialInstruction}\n` : ''}
▶ EP${ctx.id}: 「${ctx.theme}」/ "${ctx.title}"
사연자: ${ctx.name}(${ctx.age})
───────────────────────
${ctx.script}
───────────────────────

이 사연의 dj_reaction을 쓰기 전에 아래 두 가지를 먼저 파악하라.
출력에 포함하지 않아도 된다. 생성 방향을 잡기 위한 것이다.

  - 이 사연자의 행동 중 가장 모순되거나 어이없는 포인트가 무엇인가
  - 이 모순을 テンキ爺의 기계 시점으로 해석하면 어떤 비유가 가장 잘 맞는가

파악이 끝나면 아래 방식으로 써라.

  첫 문장: 사연자 이름이나 가장 날카로운 디테일로 바로 시작.
  「では」「さて」「今回は」금지.

  전개: 파악한 비유를 한 줄로 던지고 끝내지 말고 충분히 전개하라.
  비유가 전개될수록 사연자의 모순이 더 선명해지는 방향으로.
  비유의 형태는 이전 EP와 달라야 한다.

  돌려까기: 직접 "잘못됐다"고 말하지 않는다.
  아래 중 하나를 골라 3~4문장으로 전개하라. 한 줄 삽입 금지.
  어떤 방식인지는 사연 맥락에서 스스로 판단하라.
    · ワシ자기비하로 포장해서 간접적으로 상대를 부각
    · 전혀 다른 이야기로 시작해서 사연자에게 착지
    · 관찰자처럼 중계하다가 그 관찰 자체가 비판이 되게
    · 위 세 가지 외에 이 사연에 더 잘 맞는 방식을 스스로 고안

  마무리: 자기비하 키워드 포함, 2~3문장.
  직접 위로 금지. 욕인지 위로인지 헷갈리는 상태로 끝낼 것.

출력 스키마 (JSON only):
{
  "id": ${ctx.id},
  "dj_reaction": "...",
  "dj_transition": ${isLastEp ? 'null' : '"..."'}
}

분량 기준: dj_reaction 500~700字${isLastEp ? '' : ', dj_transition 80~130字'}`;

  let retryFeedback = '';
  let bestAttempt   = null;

  return withRetry(async () => {
    const prefix = retryFeedback
      ? `🚨 이전 생성에서 아래 문제가 발견됐습니다. 반드시 수정하여 재생성하세요:\n${retryFeedback}\n\n`
      : '';

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      systemInstruction: SYSTEM,
      contents: [{ role: 'user', parts: [{ text: prefix + USER }] }],
      config: GEMINI_CONFIG,
    });

    const jsonMatch = (result.text ?? '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const parsed = JSON.parse(jsonMatch[0]);

    const { lengthViolations, ruleViolations } = validateEpReaction(parsed, ctx);

    if (ruleViolations.length === 0) {
      const score = lengthViolations.reduce((acc, v) => {
        const len = parseInt(v.match(/(\d+)字/)?.[1] ?? '0');
        return acc + Math.abs(len - 600);
      }, 0);
      if (!bestAttempt || score < bestAttempt.score) bestAttempt = { parsed, score };
    }

    if (ruleViolations.length > 0 || lengthViolations.length > 0) {
      const parts = [
        ...ruleViolations.map((v, i) => `${i + 1}. [규칙 위반] ${v}`),
        ...lengthViolations.map(v => `[분량] ${v}`),
      ];
      retryFeedback = parts.join('\n');
      throw new Error(`위반 ${ruleViolations.length}건 + 분량 오류 ${lengthViolations.length}건`);
    }

    return parsed;
  }, `EP${ctx.id} dj_reaction`).catch(err => {
    if (bestAttempt) {
      console.warn(`⚠️  EP${ctx.id} 재시도 소진 — 규칙 위반 없음, 분량 편차로 진행`);
      return bestAttempt.parsed;
    }
    throw err;
  });
}

// ── 호출 4: show_opening + show_closing 생성 ─────────────────────────────────
async function generateOpeningClosing(epReactions) {
  const SYSTEM = `${personaRules}

---
あなたはテンキ爺だ。今夜の放送全体を踏まえてオープニングとクロージングを書け。
---`;

  const reactionsContext = epReactions
    .map(r => `EP${r.id} dj_reaction: ${r.dj_reaction}`)
    .join('\n\n');

  const USER = `【오늘 도쿄 날씨】${realTimeWeather}
${forbiddenBlock}
오늘 방송에서 이미 생성된 리액션:
${reactionsContext}

위 3개의 리액션 흐름을 파악하고 show_opening과 show_closing을 써라.

show_closing은 3편을 나열하거나 요약하지 않는다.
오늘 3편을 꿰뚫는 인간 관찰 하나를 テンキ爺의 언어로 정의하고,
구독 요청은 이전 회차와 다른 방식으로 변주하라.

출력 스키마 (JSON only):
{
  "show_opening": "...",
  "show_closing": "...",
  "tokyo_weather": "${realTimeWeather}",
  "used_expressions": ["어휘 로그용 5~10개"]
}

분량 기준: show_opening 150~200字, show_closing 400~550字`;

  let retryFeedback = '';
  let bestAttempt   = null;

  return withRetry(async () => {
    const prefix = retryFeedback
      ? `🚨 이전 생성에서 아래 문제가 발견됐습니다. 반드시 수정하여 재생성하세요:\n${retryFeedback}\n\n`
      : '';

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      systemInstruction: SYSTEM,
      contents: [{ role: 'user', parts: [{ text: prefix + USER }] }],
      config: GEMINI_CONFIG,
    });

    const jsonMatch = (result.text ?? '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const parsed = JSON.parse(jsonMatch[0]);

    const { lengthViolations, ruleViolations } = validateOpeningClosing(parsed);

    if (ruleViolations.length === 0) {
      const score = lengthViolations.reduce((acc, v) => {
        const len = parseInt(v.match(/(\d+)字/)?.[1] ?? '0');
        return acc + Math.abs(len - 375);
      }, 0);
      if (!bestAttempt || score < bestAttempt.score) bestAttempt = { parsed, score };
    }

    if (ruleViolations.length > 0 || lengthViolations.length > 0) {
      const parts = [
        ...ruleViolations.map((v, i) => `${i + 1}. [규칙 위반] ${v}`),
        ...lengthViolations.map(v => `[분량] ${v}`),
      ];
      retryFeedback = parts.join('\n');
      throw new Error(`위반 ${ruleViolations.length}건 + 분량 오류 ${lengthViolations.length}건`);
    }

    return parsed;
  }, 'opening/closing').catch(err => {
    if (bestAttempt) {
      console.warn('⚠️  opening/closing 재시도 소진 — 규칙 위반 없음, 분량 편차로 진행');
      return bestAttempt.parsed;
    }
    throw err;
  });
}

// ── 메인 실행 ─────────────────────────────────────────────────────────────────
console.log('🎙️  テンキ爺 DJ 멘트 생성 중 (Gemini 2.5 Pro + thinking)...');

const CHECKPOINT_PATH = path.join(path.dirname(P.djScript), '02_ep_reactions_checkpoint.json');

// 체크포인트 복원
let checkpointReactions = [];
if (fs.existsSync(CHECKPOINT_PATH)) {
  try {
    checkpointReactions = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf-8'));
    console.log(`♻️  체크포인트 복원: EP${checkpointReactions.map(r => r.id).join(', EP')} 건너뜀`);
  } catch (_) { checkpointReactions = []; }
}

// 호출 1~3: EP별 개별 생성 (순차, 체크포인트 있으면 건너뜀)
const epReactions = [...checkpointReactions];
for (const ctx of epContexts) {
  if (epReactions.find(r => r.id === ctx.id)) {
    console.log(`\n⏭️  EP${ctx.id} 체크포인트 있음 — 건너뜀`);
    continue;
  }
  console.log(`\n📻 EP${ctx.id} dj_reaction 생성 중...`);
  const reaction = await generateEpReaction(ctx);
  epReactions.push(reaction);
  // 즉시 체크포인트 저장
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(epReactions, null, 2), 'utf-8');
  console.log(`   ✅ EP${ctx.id} 완료 (reaction: ${reaction.dj_reaction.length}字)`);
}

// 호출 4: opening + closing (3개 reaction을 컨텍스트로 전달)
console.log('\n📻 show_opening + show_closing 생성 중...');
const openingClosing = await generateOpeningClosing(epReactions);
console.log(`   ✅ opening(${openingClosing.show_opening.length}字) + closing(${openingClosing.show_closing.length}字) 완료`);

// ── 어휘 로그 업데이트 ────────────────────────────────────────────────────────
const usedExpressions = openingClosing.used_expressions ?? [];
if (usedExpressions.length > 0) {
  vocabLog.recent_eps.push({ ep_id: epId, generated_at: new Date().toISOString(), expressions: usedExpressions });
  if (vocabLog.recent_eps.length > 3) vocabLog.recent_eps.shift();
  fs.writeFileSync(VOCAB_LOG_PATH, JSON.stringify(vocabLog, null, 2), 'utf-8');
  console.log(`📝 어휘 로그 업데이트 (${usedExpressions.length}개 표현 기록)`);
}

// ── 결과 병합 → 02_dj_script.json ────────────────────────────────────────────
const merged = {
  show_opening:  openingClosing.show_opening  || 'おう、電波泥棒ども！今夜もワシのポンコツ電波を盗みに来やがったか。',
  show_closing:  openingClosing.show_closing  || 'ふん、今夜はここまでだ。また次回な、コノヤロー！',
  tokyo_weather: realTimeWeather,
  episodes: episodes.map(ep => {
    const djEp = epReactions.find(r => r.id === ep.id);
    return {
      ...ep,
      dj_reaction:   djEp?.dj_reaction   || `EP${ep.id}か... まあ、それなりに生きてるじゃないか。`,
      dj_transition: djEp?.dj_transition ?? null,
    };
  }),
};

fs.writeFileSync(P.djScript, JSON.stringify(merged, null, 2), 'utf-8');
if (fs.existsSync(CHECKPOINT_PATH)) fs.unlinkSync(CHECKPOINT_PATH);
validateDjScript(merged);
updateStage(P, 'dj_script');

console.log('\n✅ 02_dj_script.json 저장 완료');
console.log(`   🌤  날씨: ${realTimeWeather}`);
console.log(`   오프닝(${merged.show_opening.length}字): ${merged.show_opening.slice(0, 60)}...`);
merged.episodes.forEach(ep => {
  const ctx  = epContexts.find(c => c.id === ep.id);
  const tags = [ctx?.isMZ ? '[MZ]' : '', ctx?.isVillain ? '[빌런]' : ''].filter(Boolean).join(' ');
  console.log(`   EP${ep.id}${tags ? ' ' + tags : ''} 리액션(${ep.dj_reaction.length}字): ${ep.dj_reaction.slice(0, 60)}...`);
});
console.log(`   엔딩(${merged.show_closing.length}字): ${merged.show_closing.slice(0, 60)}...`);
