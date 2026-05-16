/**
 * run_08_qa_regen.mjs — 08_qa_script.json 단독 재생성
 *
 * 사용처: Q&A 대본만 깨졌을 때 DJ 멘트 전체 재생성 없이 복구
 * 전제:   02_dj_script.json (show_closing용 outro) 존재 필요
 *
 * 실행:
 *   EP_ID=EP_6_youtube node .radio_output/run_08_qa_regen.mjs
 *   EP_ID=EP_6_youtube node .radio_output/run_08_qa_regen.mjs --force
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

const FORCE = process.argv.includes('--force');

if (!FORCE && fs.existsSync(P.qaScript)) {
  console.log(`⏭️  08_qa_script.json 이미 존재 — --force 로 재생성 가능`);
  process.exit(0);
}

const GEMINI_KEY = requireEnv('GEMINI_API_KEY');
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

const personaRules = fs.readFileSync(P.refPersona, 'utf-8');

let outro = '';
if (fs.existsSync(P.djScript)) {
  const djScript = JSON.parse(fs.readFileSync(P.djScript, 'utf-8'));
  outro = djScript.show_closing ?? '';
}

const GEMINI_CONFIG = {
  temperature:     1.0,
  maxOutputTokens: 8192,
  thinkingConfig:  { thinkingBudget: 8000 },
};

async function withRetry(fn, label, maxRetry = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️  ${label} 재시도 ${attempt + 1}/${maxRetry}: ${err.message?.slice(0, 120)}`);
      if (attempt < maxRetry - 1) {
        const delay = 4000 * (attempt + 1);
        console.log(`⏳ ${Math.round(delay / 1000)}초 후 재시도...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function generateQaSegment() {
  const SYSTEM = `${personaRules}

---
あなたはテンキ爺だ。今から「即問即答コーナー」を進行する。
【言語ルール】イントロ・質問・答弁、全ての出力は必ず日本語で書け。ハングル（韓国語）は絶対に使わないこと。
質問数：正確に5個。各答弁60文字以上。自己卑下キーワード全体3回以上。
---`;

  const USER = `【重要】全ての出力（intro・q・a）を必ず日本語で書くこと。ハングル（韓国語）は絶対禁止。

即問即答コーナーの台本をJSONで生成せよ。

ルール:
- 質問数: 正確に5個
- 5個中最低1個: 関節炎・老眼鏡・健康診断・孫へのお小遣い・降圧剤・不眠症など シニアの日常悩み
- 答弁構造: ① あきれた反応 → ② 毒舌+自己卑下比喩(ポンコツ/8ビット/256KB のどれか)+説教1文 → ③ ぶっきらぼうな慰め1文
- 5問答全体に自己卑下キーワード(ポンコツ/ガラクタ/8ビット/256KB/廃品回収/錆/ネジが緩い/旧型) 最低3回
- 各答弁最低60文字
- 許可Audioタグを積極活用: [sighs][laughs][scoffs][chuckles][nervous][angry]

出力スキーマ (JSON only):
{
  "intro": "コーナー入り台詞 (50~80字)",
  "pairs": [
    {"q": "リスナーの質問 (日本語)", "a": "テンキ爺の答弁 (日本語、60字以上)"},
    {"q": "...", "a": "..."},
    {"q": "...", "a": "..."},
    {"q": "...", "a": "..."},
    {"q": "...", "a": "..."}
  ]
}`;

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

    const errors = [];
    const koreanCharPattern = /[가-힣ᄀ-ᇿ㄰-㆏]/;
    if (koreanCharPattern.test(JSON.stringify(parsed))) {
      errors.push('ハングル（韓国語）検出 — 全て日本語で再生成すること');
    }
    if (!parsed.intro?.trim()) errors.push('intro 없음');
    if (!Array.isArray(parsed.pairs)) {
      errors.push('pairs 배열 없음');
    } else {
      if (parsed.pairs.length !== 5) errors.push(`pairs ${parsed.pairs.length}개 — 정확히 5개 필요`);
      parsed.pairs.forEach((p, i) => {
        if (!p.q?.trim()) errors.push(`Q${i + 1} 질문 없음`);
        if (!p.a?.trim()) errors.push(`Q${i + 1} 답변 없음`);
        if ((p.a || '').length < 60) errors.push(`Q${i + 1} 답변 ${(p.a || '').length}字 — 60字 이상 필요`);
      });
      const selfDeprecCount = (JSON.stringify(parsed.pairs) || '').match(/ポンコツ|ガラクタ|8ビット|256KB|廃品回収|錆|ネジが緩い|旧型/g)?.length ?? 0;
      if (selfDeprecCount < 3) errors.push(`자기비하 키워드 ${selfDeprecCount}회 — 3회 이상 필요`);
    }

    if (errors.length === 0 && !bestAttempt) bestAttempt = { parsed };

    if (errors.length > 0) {
      retryFeedback = errors.join('\n');
      throw new Error(`검증 실패: ${errors.join(' / ')}`);
    }

    return parsed;
  }, 'qa_segment').catch(err => {
    if (bestAttempt) {
      console.warn('⚠️  qa_segment 재시도 소진 — bestAttempt으로 진행');
      return bestAttempt.parsed;
    }
    throw err;
  });
}

console.log(`🎙️  [${epId}] 즉문즉답 Q&A 대본 재생성 중...`);
const qaSegment = await generateQaSegment();

const qaOut = {
  intro:    qaSegment.intro || '',
  qa_pairs: (qaSegment.pairs || []).map(p => ({ question: p.q, answer: p.a })),
  outro,
};

fs.writeFileSync(P.qaScript, JSON.stringify(qaOut, null, 2), 'utf-8');
console.log(`✅ 08_qa_script.json 저장 완료`);
console.log(`   intro: ${qaOut.intro.slice(0, 60)}...`);
console.log(`   Q&A: ${qaOut.qa_pairs.length}쌍`);
qaOut.qa_pairs.forEach((p, i) => {
  console.log(`   Q${i + 1}: ${p.question.slice(0, 40)}...`);
});
