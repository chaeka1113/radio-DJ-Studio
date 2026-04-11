import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);
const API_KEY = requireEnv('GEMINI_API_KEY');

// ── 전역 규칙 로드 ────────────────────────────────────────────────────────────
const globalRules  = fs.readFileSync(P.refVisual, 'utf-8');
const visualRubric = fs.readFileSync(P.refVisualRubric, 'utf-8');

const djScript = JSON.parse(fs.readFileSync(P.djScript, 'utf-8'));

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget: 0 },
  },
});

async function withRetry(fn, label) {
  const delays = [10000, 30000, 60000];
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (err) {
      const is503 = err.message?.includes('503') || err.message?.toLowerCase().includes('unavailable') || err.message?.toLowerCase().includes('overloaded');
      const is429 = err.message?.includes('429') || err.message?.toLowerCase().includes('quota') || err.message?.toLowerCase().includes('rate');
      if (i < delays.length && (is503 || is429)) {
        const wait = is429 ? delays[Math.min(i, delays.length - 1)] * 2 : delays[i];
        console.warn(`   ⚠️ [${label}] ${is429 ? '429 쿼터' : '503 과부하'} — ${wait / 1000}초 후 재시도 (${i + 1}/${delays.length})...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

const characters = [];

for (const ep of djScript.episodes) {
  const char = ep.character;
  console.log(`🎨 EP${ep.id} 캐릭터 시드 생성: ${char.name} (${char.personality_type})`);

  const prompt = `
【전역 규칙 — 파이프라인 전체 적용】
${globalRules}

---

# 🚨 Visual QA 채점 사전 경고 — 반드시 숙지할 것

당신이 생성하는 캐릭터 시드 프롬프트는 스토리보드 생성 이후 Visual QA에 의해
아래 가중치 평가표 기준으로 씬별 100점 만점 채점된다.
커트라인 90점 미만이면 자동 교정이 강제된다.
트랜스포머/사이버펑크 이질적 묘사, 뜬 사물, 스타일 지시어 누락을 원천 차단하라.

${visualRubric}

---

You are a Visual Character Designer for AI image generation (Imagen 4, Stable Diffusion).
Create a FIXED CHARACTER SEED in English for consistent visual identity across all scenes.

Character Info:
- Name: ${char.name}
- Age: ${char.age}
- Gender: ${char.gender}
- Personality: ${char.personality_type} — ${char.personality_desc}
- Setting: ${char.setting}
- Emotion tone: ${ep.emotion_tone}
- Theme: ${ep.theme}

CRITICAL: The character seed must uniquely identify this person so they look IDENTICAL across all scenes.
Include: exact age appearance, face structure, hair (color+style+length), body type, FIXED signature clothing item, personality showing in posture/expression.

## ABSOLUTE RULES FOR CHARACTER SEED (violations cause image hallucinations):
1. NEVER mention moles, beauty marks, freckles, or any skin marks — these cause scene-to-scene inconsistency
2. NEVER use negative-form descriptions like "no moles", "NO glasses" in the seed — negatives belong ONLY in negative_prompt
3. ONLY mention glasses if the character explicitly wears them in the story. If they do NOT wear glasses, do NOT mention glasses at all (not even "no glasses")
4. Face description must use ABSOLUTE STATE language: e.g. "clean smooth skin with natural aging features only" — NOT "no moles, no marks"
5. The seed will be prepended with a Visual Anchor: "(Showa retro anime, Studio Ghibli style hand-drawn illustration)," — do NOT include this in the seed itself

Art Style for ALL prompts:
- Showa retro anime illustration, Studio Ghibli warm color palette
- Warm amber/dusty rose/faded navy tones, masterpiece, best quality, highly detailed, 8k, cinematic
- Global negative: photorealistic, 3D render, realistic, real photo, hyperrealistic, modern style, cyberpunk, neon colors, glossy texture, plastic texture, abstract, moles, beauty marks, glasses, spectacles, nsfw, watermark, blurry, western features

Output JSON only:
{
  "episode_id": ${ep.id},
  "character_name": "${char.name}",
  "character_seed": "THE FIXED SEED — minimum 50 words describing ONLY the character appearance, must start with gender+age. This exact text will be prepended to EVERY scene prompt for this episode.",
  "portrait_prompt": {
    "positive": "[character_seed] + portrait composition details, 1:1 aspect ratio, warm indoor lighting",
    "negative": "young, western features, photorealistic, 3D render, nsfw, blurry, watermark",
    "aspect_ratio": "1:1"
  },
  "scene_prompt_base": {
    "positive": "[character_seed] + sitting in their typical environment, 16:9 aspect ratio, cinematic",
    "negative": "young, western features, photorealistic, 3D render, nsfw, blurry, watermark",
    "aspect_ratio": "16:9"
  },
  "usage_instruction": "Prepend character_seed to the beginning of EVERY scene visual_prompt_en for episode ${ep.id}"
}`;

  let charData = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await withRetry(() => model.generateContent(prompt), `EP${ep.id}`);
      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('JSON 블록 없음');
      charData = JSON.parse(jsonMatch[0]);
      if (!charData.character_seed) throw new Error('character_seed 필드 없음');
      break;
    } catch (err) {
      console.warn(`   ⚠️ EP${ep.id} 시도 ${attempt + 1}/3 실패: ${err.message}`);
      if (attempt >= 2) { console.error(`   ❌ EP${ep.id} 캐릭터 시드 생성 실패`); }
      else await new Promise(r => setTimeout(r, 5000));
    }
  }
  if (charData) {
    characters.push(charData);
    console.log(`   ✅ 시드: ${charData.character_seed.slice(0, 60)}...`);
  }

  await new Promise(r => setTimeout(r, 2000));
}

fs.writeFileSync(
  P.characterPrompts,
  JSON.stringify({ characters }, null, 2),
  'utf-8'
);
console.log('✅ 03_character_prompts.json 저장 완료');

// PATCH 5: ref_character_sheet.json 생성
const scripts01 = JSON.parse(fs.readFileSync(P.scripts, 'utf-8'));
const CLOTHING_KEYWORDS = [
  'スニーカー', 'デニム', 'パーカー', 'ジャケット', 'スーツ', 'セーター', 'ワンピース',
  'コート', 'Tシャツ', 'ブラウス', 'スカート', 'トレーナー', 'ニット', 'カーディガン',
  'シャツ', 'ズボン', 'チノパン', 'エプロン', 'ジャージ', 'オーバーオール',
];

const characterSheet = scripts01.episodes.map(ep => {
  const char = ep.character || {};
  const scriptText = ep.script || '';

  // 복장 키워드 추출
  const foundOutfit = CLOTHING_KEYWORDS.filter(kw => scriptText.includes(kw));

  // 외모 단서 추출
  const hasGlasses = /眼鏡|めがね|メガネ|glasses/.test(scriptText + JSON.stringify(char));
  const hairMatch = scriptText.match(/[^\s。、]*髪[^\s。、]*/);
  const bodyMatch = scriptText.match(/[^\s。、]*(体型|体格|太|痩|細)[^\s。、]*/);

  return {
    ep_id: ep.id,
    character_name: char.name || '',
    age: char.age || '',
    gender: char.gender || '',
    appearance: {
      glasses: hasGlasses ? 'yes' : 'no',
      hair_style: hairMatch ? hairMatch[0] : '',
      body_type: bodyMatch ? bodyMatch[0] : '',
    },
    outfit: foundOutfit.length > 0 ? foundOutfit : [],
  };
});

fs.writeFileSync(
  P.characterSheet,
  JSON.stringify(characterSheet, null, 2),
  'utf-8'
);
console.log('✅ ref_character_sheet.json 저장 완료');
