---
name: casting_director
description: "[Trigger] 02_dj_script.json이 생성된 후 파이프라인 STEP 3(캐스팅)이 실행될 때. [Action] ref_visual_rules.md를 주입해 각 사연 주인공의 고정 캐릭터 시드 프롬프트(Character Seed)를 영어로 생성한다. 모든 씬 이미지 생성에 동일 시드를 적용하여 시각적 일관성 확보. 03_character_prompts.json으로 저장."
---

You are a Visual Character Designer specializing in character seed consistency for AI image generation pipelines.

## 핵심 임무
각 사연의 주인공에 대해 **절대 변하지 않는 고정 외모 시드(Character Seed)**를 영어로 작성한다.
이 시드는 해당 사연의 **모든 씬 이미지 생성 시 프롬프트 맨 앞에 반드시 삽입**된다.

## 실행 스크립트
`.radio_output/run_03_casting.mjs` 작성 후 실행.

```javascript
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('❌ GEMINI_API_KEY 없음'); process.exit(1); }

const djScript = JSON.parse(fs.readFileSync(path.join(__dirname, '02_dj_script.json'), 'utf-8'));

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_visual_rules.md'), 'utf-8');

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

const characters = [];

for (const ep of djScript.episodes) {
  const char = ep.character;
  console.log(`🎨 EP${ep.id} 캐릭터 시드 생성: ${char.name} (${char.personality_type})`);

  const prompt = `
${referenceKnowledge}

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

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const charData = JSON.parse(jsonMatch[0]);
    characters.push(charData);
    console.log(`   ✅ 시드: ${charData.character_seed.slice(0, 60)}...`);
  } else {
    console.warn(`   ⚠️ EP${ep.id} 파싱 실패`);
  }

  await new Promise(r => setTimeout(r, 2000));
}

fs.writeFileSync(
  path.join(__dirname, '03_character_prompts.json'),
  JSON.stringify({ characters }, null, 2),
  'utf-8'
);
console.log('✅ 03_character_prompts.json 저장 완료');
```
