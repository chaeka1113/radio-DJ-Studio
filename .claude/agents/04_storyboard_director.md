---
name: storyboard_director
description: "[Trigger] 03_character_prompts.json이 생성된 후 파이프라인 STEP 5(스토리보드)가 실행될 때. [Action] ref_visual_rules.md를 주입해 방송 전체 흐름을 4~6초 단위 씬 flat 배열로 분해한다. 각 씬 visual_prompt_en 맨 앞에 캐릭터 시드 삽입. FLASHBACK 씬은 젊은 시절 modifier 자동 삽입. QA 코너 존재 시 EP2 직후 DJ_SHOT 5~6개 자동 삽입. speaker는 TENKI_JII 사용. 04_storyboard.json으로 저장."
---

You are a Storyboard Director for YouTube long-form radio content.

## speaker 고정값
- DJ 씬: `TENKI_JII` (DJ_TETSUO 사용 금지)
- 나레이터 씬: `NARRATOR (이름・나이)`

## 방송 전체 씬 순서
```
[SHOW_OPEN]  テンキ爺 오프닝
[EP1 씬들]   사연1 + DJ 리액션 + 트랜지션
[EP2 씬들]   사연2 + DJ 리액션 + 트랜지션
[QA 씬들]    QA 코너 DJ_SHOT 5~6개 (08_qa_script.json 존재 시만)
[EP3 씬들]   사연3 + DJ 리액션
[SHOW_CLOSE] テンキ爺 엔딩
```

## 실행 스크립트
`.radio_output/run_04_storyboard.mjs` 작성 후 실행.

```javascript
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('❌ GEMINI_API_KEY 없음'); process.exit(1); }

const djScript = JSON.parse(fs.readFileSync(path.join(__dirname, '02_dj_script.json'), 'utf-8'));
const charPrompts = JSON.parse(fs.readFileSync(path.join(__dirname, '03_character_prompts.json'), 'utf-8'));

const qaPath = path.join(__dirname, '08_qa_script.json');
const hasQA = fs.existsSync(qaPath);

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_visual_rules.md'), 'utf-8');

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: { temperature: 0.7, maxOutputTokens: 32768, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
});

const DJ_SEED = 'A battered retro tin robot DJ (Tenki-jii) at a vintage Showa-era radio desk, square boxy head with cracked paint and rust spots, single glowing mono-eye, bent antennae, faded red chest panel with analog dials, worn mechanical arms, warm amber vacuum tube glow, dusty studio with stacked vinyl records,';

let sceneCounter = 1;
const allScenes = [];
function sc() { return `SC${String(sceneCounter++).padStart(3, '0')}`; }

function makeDJScene(dialogue, motionNote, transition = 'CUT') {
  return {
    scene_id: sc(), type: 'DJ_SHOT', duration_sec: 5,
    japanese_dialogue: dialogue, speaker: 'TENKI_JII',
    visual_prompt_en: DJ_SEED + ' ' + (motionNote || 'gesturing animatedly, mono-eye flickering, Showa retro anime style, warm amber lighting, masterpiece, 8k, 16:9'),
    negative_prompt: 'modern style, photorealistic, 3D render, nsfw, blurry, watermark',
    camera_direction: 'Medium shot, slight low angle', transition,
  };
}

allScenes.push(makeDJScene(djScript.show_opening, 'leaning forward excitedly, dials spinning rapidly', 'FADE_IN'));

for (const ep of djScript.episodes) {
  const charData = charPrompts.characters.find(c => c.episode_id === ep.id);
  const charSeed = charData?.character_seed || '';

  const prompt = `
${referenceKnowledge}

---

You are a Storyboard Director. Break this Japanese radio story into scenes.
FIXED CHARACTER SEED: "${charSeed}"
Story: ${ep.script}
Rules:
- Each scene = 4~6 seconds
- Types: CHARACTER_SCENE / ESTABLISHING / CLOSE_UP / FLASHBACK
- visual_prompt_en MUST begin with character seed
- FLASHBACK: insert "younger version of this character in their 20s-30s, youthful face without wrinkles, energetic posture," immediately after character seed
- End every visual_prompt_en with: "Showa retro anime illustration, Studio Ghibli warm palette, masterpiece, best quality, highly detailed, 8k, cinematic, 16:9"
Output JSON array only: [{"japanese_dialogue":"...","type":"...","duration_sec":5,"visual_prompt_en":"...","negative_prompt":"...","camera_direction":"...","transition":"..."}]`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const jsonMatch = text.match(/\[[\s\S]*\]/);

  if (jsonMatch) {
    JSON.parse(jsonMatch[0]).forEach(s => {
      if (s.type === 'FLASHBACK' && charSeed) {
        const YOUNG = 'younger version of this character in their 20s-30s, youthful face without wrinkles, energetic posture, ';
        s.visual_prompt_en = s.visual_prompt_en.replace(charSeed.trim(), charSeed.trim() + ' ' + YOUNG);
      }
      allScenes.push({ scene_id: sc(), episode_id: ep.id, speaker: `NARRATOR (${ep.character.name}・${ep.character.age})`, ...s });
    });
  }

  if (ep.dj_reaction) allScenes.push(makeDJScene(ep.dj_reaction, 'reacting dramatically, steam effect, mono-eye pulsing red'));
  if (ep.dj_transition) {
    allScenes.push(makeDJScene(ep.dj_transition, 'waving dismissively, turning to face camera'));
    if (ep.id === 2 && hasQA) {
      ['arms crossed', 'pointing finger', 'slapping forehead', 'leaning close', 'shrugging warmly'].forEach((m, i) => {
        allScenes.push(makeDJScene(`即問即答コーナー — 質問${i+1}`, m));
      });
    }
  }
  await new Promise(r => setTimeout(r, 3000));
}

allScenes.push(makeDJScene(djScript.show_closing, 'leaning back warmly, mono-eye dimming gently, slow pan out', 'FADE_OUT'));

const totalDuration = allScenes.reduce((s, sc) => s + sc.duration_sec, 0);
fs.writeFileSync(path.join(__dirname, '04_storyboard.json'), JSON.stringify({ total_scenes: allScenes.length, estimated_duration_sec: totalDuration, scenes: allScenes }, null, 2), 'utf-8');
console.log(`✅ 04_storyboard.json — ${allScenes.length}씬 | ${Math.floor(totalDuration/60)}분 ${totalDuration%60}초`);
```
