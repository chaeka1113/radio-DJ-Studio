import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);
const API_KEY = requireEnv('ANTHROPIC_API_KEY');
const client = new Anthropic({ apiKey: API_KEY });

const CAST_MODEL = 'claude-sonnet-4-5';

// ── 전역 규칙 로드 ────────────────────────────────────────────────────────────
const globalRules  = fs.readFileSync(P.refVisual, 'utf-8');
const visualRubric = fs.readFileSync(P.refVisualRubric, 'utf-8');

const djScript = JSON.parse(fs.readFileSync(P.djScript, 'utf-8'));


const characters = [];

for (const ep of djScript.episodes) {
  const char = ep.character;
  console.log(`🎨 EP${ep.id} 주인공 시드 생성: ${char.name} (${char.personality_type})`);

  // ── 1) 주인공 캐릭터 시드 생성 ─────────────────────────────────────────────
  const mainPrompt = `
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
      const message = await client.messages.create({
        model: CAST_MODEL,
        max_tokens: 8192,
        temperature: 0.7,
        messages: [{ role: 'user', content: mainPrompt }],
      });
      const text = message.content[0]?.text ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('JSON 블록 없음');
      charData = JSON.parse(jsonMatch[0]);
      if (!charData.character_seed) throw new Error('character_seed 필드 없음');
      break;
    } catch (err) {
      const msg = err.message ?? '';
      if (msg.includes('credit balance') || err.status === 529) {
        console.error(`   ❌ Claude API 크레딧 부족 — 즉시 중단`);
        process.exit(1);
      }
      console.warn(`   ⚠️ EP${ep.id} 주인공 시도 ${attempt + 1}/3 실패: ${msg.slice(0, 200)}`);
      if (attempt >= 2) { console.error(`   ❌ EP${ep.id} 주인공 시드 생성 실패`); }
      else await new Promise(r => setTimeout(r, 5000));
    }
  }

  if (!charData) {
    await new Promise(r => setTimeout(r, 2000));
    continue;
  }
  console.log(`   ✅ 주인공 시드: ${charData.character_seed.slice(0, 60)}...`);

  // ── 2) 보조 캐릭터 시드 생성 ───────────────────────────────────────────────
  console.log(`🎭 EP${ep.id} 보조 캐릭터 추출 중...`);

  const scriptText = ep.script ?? '';

  const secondaryPrompt = `
You are a Visual Character Designer analyzing a Japanese radio drama script.

Your task:
1. Read the script below and identify ALL secondary characters who appear more than once or play a meaningful role in the story.
2. For each secondary character, create a FIXED CHARACTER SEED for visual consistency across scenes.
3. Generate detection_keywords (English phrases) that would appear in an AI image generation prompt describing that character in a scene.

Script (Episode ${ep.id} — "${ep.title}"):
---
${scriptText}
---

Main protagonist (EXCLUDE from your output — already handled separately):
- Name: ${char.name}, Age: ${char.age}

## RULES FOR SECONDARY CHARACTER SEEDS:
1. Each seed must be in English, minimum 40 words
2. Describe age, gender, face structure, hair, body type, clothing
3. Use ABSOLUTE STATE language ("clean smooth skin") — NO negative-form ("no moles")
4. DO NOT mention glasses/spectacles unless explicitly stated in script
5. Art style context: Showa retro anime, Studio Ghibli illustration

## RULES FOR DETECTION_KEYWORDS:
- These are English phrases that an image generation prompt would use when this character appears in a scene
- Must be specific enough to avoid false matches (e.g. "his father" not just "man")
- Include 3-6 keywords per character
- They will be matched against scene visual_prompt_en using substring search

Output JSON only (array, can be empty [] if no meaningful secondary characters):
[
  {
    "character_key": "short_snake_case_id (e.g. father, mother, younger_brother, sento_grandmother)",
    "character_name": "Japanese name or role label",
    "role": "relationship to protagonist (e.g. 父親, 母親, 弟, 銭湯の番台)",
    "character_seed": "English visual description seed, 40+ words",
    "detection_keywords": ["english phrase 1", "english phrase 2", "english phrase 3"]
  }
]

If there are no secondary characters worth seeding (e.g. only mentioned in passing), output: []
`;

  let secondaryChars = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const message = await client.messages.create({
        model: CAST_MODEL,
        max_tokens: 8192,
        temperature: 0.7,
        messages: [{ role: 'user', content: secondaryPrompt }],
      });
      const text = message.content[0]?.text ?? '';
      // JSON 배열 추출 (객체 안에 배열이 있거나 배열 자체일 수 있음)
      const arrMatch = text.match(/\[[\s\S]*\]/);
      if (!arrMatch) throw new Error('JSON 배열 없음');
      secondaryChars = JSON.parse(arrMatch[0]);
      if (!Array.isArray(secondaryChars)) throw new Error('배열이 아님');
      console.log(`   ✅ 보조 캐릭터 ${secondaryChars.length}명 생성`);
      secondaryChars.forEach(c => {
        console.log(`      - ${c.character_key} (${c.role}): ${c.character_seed.slice(0, 50)}...`);
      });
      break;
    } catch (err) {
      const msg = err.message ?? '';
      if (msg.includes('credit balance') || err.status === 529) {
        console.error(`   ❌ Claude API 크레딧 부족 — 즉시 중단`);
        process.exit(1);
      }
      console.warn(`   ⚠️ EP${ep.id} 보조 캐릭터 시도 ${attempt + 1}/3 실패: ${msg.slice(0, 200)}`);
      if (attempt >= 2) {
        console.error(`   ❌ EP${ep.id} 보조 캐릭터 생성 실패 — 빈 배열로 계속`);
        secondaryChars = [];
      } else {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  charData.secondary_characters = secondaryChars;
  characters.push(charData);

  await new Promise(r => setTimeout(r, 2000));
}

fs.writeFileSync(
  P.characterPrompts,
  JSON.stringify({ characters }, null, 2),
  'utf-8'
);
console.log('✅ 03_character_prompts.json 저장 완료');

// ── ref_character_sheet.json 생성 ────────────────────────────────────────────
const scripts01 = JSON.parse(fs.readFileSync(P.scripts, 'utf-8'));
const CLOTHING_KEYWORDS = [
  'スニーカー', 'デニム', 'パーカー', 'ジャケット', 'スーツ', 'セーター', 'ワンピース',
  'コート', 'Tシャツ', 'ブラウス', 'スカート', 'トレーナー', 'ニット', 'カーディガン',
  'シャツ', 'ズボン', 'チノパン', 'エプロン', 'ジャージ', 'オーバーオール',
];

const characterSheet = scripts01.episodes.map(ep => {
  const char = ep.character || {};
  const scriptText = ep.script || '';

  const foundOutfit = CLOTHING_KEYWORDS.filter(kw => scriptText.includes(kw));

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
