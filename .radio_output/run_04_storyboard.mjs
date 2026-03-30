import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('❌ GEMINI_API_KEY 없음'); process.exit(1); }

// ── 전역 규칙 로드 ────────────────────────────────────────────────────────────
const globalRules = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_visual_rules.md'), 'utf-8');
const visualRubric = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_visual_rubric.md'), 'utf-8');

const djScript = JSON.parse(fs.readFileSync(path.join(__dirname, '02_dj_script.json'), 'utf-8'));
const charPrompts = JSON.parse(fs.readFileSync(path.join(__dirname, '03_character_prompts.json'), 'utf-8'));

// PATCH 6: ref_character_sheet.json 로드
let characterSheet = {};
const sheetPath = path.join(__dirname, 'ref_character_sheet.json');
if (fs.existsSync(sheetPath)) {
  characterSheet = JSON.parse(fs.readFileSync(sheetPath, 'utf-8'));
}

const qaPath = path.join(__dirname, '08_qa_script.json');
const hasQA = fs.existsSync(qaPath);
if (hasQA) console.log('ℹ️  QA 코너 감지 → EP2 직후 DJ_SHOT 씬 삽입 예정');

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 32768,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget: 0 },
  },
});

// テンキ爺 고정 시드 (TENKI_JII)
const DJ_SEED = '(Showa retro anime, Studio Ghibli style hand-drawn illustration), A battered retro tin robot DJ (Tenki-jii) at a vintage Showa-era radio desk, square boxy head with cracked paint and rust spots, single glowing mono-eye, bent antennae, faded red chest panel with analog dials, worn mechanical arms, warm amber vacuum tube glow, dusty studio with stacked vinyl records,';

// 나이 앵커 생성기
function getAgeAnchor(age) {
  const n = parseInt(age) || 0;
  if (n <= 29) return '(Young 20s smooth face, no wrinkles, youthful clear skin),';
  if (n <= 39) return '(30s face, minimal fine lines, young-adult appearance),';
  if (n <= 55) return '(Middle-aged face, visible laugh lines, mature look),';
  if (n <= 69) return '(60s face, clear deep wrinkles, salt-and-pepper or gray hair),';
  return '(Deeply wrinkled 70s+ face, heavy age lines, white or gray hair),';
}

const STYLE_ANCHOR = '(Showa retro anime, Studio Ghibli style hand-drawn illustration),';

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

let sceneCounter = 1;
const allScenes = [];

function sc() { return `SC${String(sceneCounter++).padStart(3, '0')}`; }

function makeDJScene(dialogue, motionNote, transition = 'CUT') {
  return {
    scene_id: sc(),
    type: 'DJ_SHOT',
    duration_sec: 5,
    japanese_dialogue: dialogue,
    speaker: 'TENKI_JII',   // DJ_TETSUO → TENKI_JII
    visual_prompt_en: DJ_SEED + ' ' + (motionNote || 'gesturing animatedly, mono-eye flickering,') + ' Showa retro anime illustration, Studio Ghibli warm palette, masterpiece, best quality, highly detailed, 8k, cinematic, 16:9',
    negative_prompt: 'modern style, photorealistic, 3D render, nsfw, blurry, watermark',
    camera_direction: 'Medium shot, slight low angle',
    transition,
  };
}

// ── 방송 오프닝
allScenes.push(makeDJScene(djScript.show_opening, 'leaning forward excitedly, dials spinning rapidly', 'FADE_IN'));

// ── 에피소드 처리
for (const ep of djScript.episodes) {
  const charData = charPrompts.characters.find(c => c.episode_id === ep.id);
  const charSeed = charData?.character_seed || '';

  console.log(`🎬 EP${ep.id} 스토리보드 생성: "${ep.title}"`);

  // PATCH 6: 해당 에피소드의 캐릭터 시트 제약 구성
  const epSheet = Array.isArray(characterSheet) ? characterSheet.find(s => s.ep_id === ep.id) : null;

  // 영어 시각 제약 문자열 — visual_prompt_en 앞에 직접 삽입
  let englishVisualConstraint = '';
  if (epSheet) {
    // 안경 미착용 시 언급 자체를 삭제 — 부정형("NO glasses")은 Imagen 혼란 유발
    const glassesDesc = epSheet.appearance.glasses === 'yes' ? 'wearing glasses,' : '';
    const outfitDesc = epSheet.outfit.length > 0 ? epSheet.outfit.join(', ') + ',' : '';
    const hairDesc = epSheet.appearance.hair_style ? `${epSheet.appearance.hair_style} hair,` : '';
    englishVisualConstraint = `${glassesDesc} ${hairDesc} ${outfitDesc}`.replace(/\s+/g, ' ').trim();
  }

  const charConstraintBlock = epSheet ? `
【絶対遵守 キャラクタービジュアル制約 — MUST FOLLOW IN EVERY SCENE】
Character: ${epSheet.character_name} (${epSheet.age} / ${epSheet.gender})
ENGLISH VISUAL CONSTRAINT (copy verbatim into every visual_prompt_en for this character):
"${englishVisualConstraint}"

RULES:
- The English constraint above MUST appear immediately after the character seed in EVERY scene where this character appears.
- NEVER add or remove glasses. If constraint says "NO glasses", the character MUST have NO glasses in ALL scenes.
- NEVER change clothing. Keep the exact outfit described throughout all scenes.
- Violating these constraints is a critical error.
` : '';

  const prompt = `
【전역 규칙 — 파이프라인 전체 적용】
${globalRules}
${charConstraintBlock}
---

# 🚨 Visual QA 채점 사전 경고 — 반드시 숙지할 것

당신이 생성하는 모든 씬의 visual_prompt_en은 생성 직후 Visual QA에 의해
아래 가중치 평가표 기준으로 씬별 100점 만점 채점된다.
커트라인 90점 미만 씬은 자동 교정이 강제되며, 다음을 원천 차단하라:
- positive_prompt에 cyberpunk/neon colors/Transformer style/abstract 절대 금지
- negative_prompt에 금지 스타일 전체 명시 필수
- 사물/신체 접촉에 물리적 동사 명시 (공중 부유 금지)
- 매 씬 끝에 표준 아트 스타일 지시어 전체 포함 필수

${visualRubric}

---

You are a Storyboard Director. Break this Japanese radio story into scenes for AI video generation.

FIXED CHARACTER SEED + VISUAL CONSTRAINT — prepend EXACTLY this to ALL scene visual_prompt_en in this episode:
"${charSeed}${englishVisualConstraint ? ' ' + englishVisualConstraint : ''}"

⚠️ The visual constraint (glasses, outfit, hair) is ABSOLUTE and must not change between scenes.

Story:
${ep.script}

Rules:
- Each scene = 4~6 seconds (~20~35 Japanese chars at natural reading pace)
- scene types: CHARACTER_SCENE / ESTABLISHING / CLOSE_UP / FLASHBACK
- visual_prompt_en MUST begin with the character seed above, then add scene-specific action/setting details
- FLASHBACK scenes: immediately after the character seed, insert "younger version of this character in their 20s-30s, youthful face without wrinkles, energetic posture," to show the past/youth version
- End every visual_prompt_en with: "Showa retro anime illustration, Studio Ghibli warm palette, masterpiece, best quality, highly detailed, 8k, cinematic, 16:9"
- speaker format: "NARRATOR (${ep.character.name}・${ep.character.age})"

Output JSON array only:
[
  {
    "japanese_dialogue": "台詞テキスト",
    "type": "CHARACTER_SCENE|ESTABLISHING|CLOSE_UP|FLASHBACK",
    "duration_sec": 5,
    "visual_prompt_en": "[character seed], [scene action/setting], Showa retro anime...",
    "negative_prompt": "modern style, photorealistic, 3D render, nsfw, blurry, western features",
    "camera_direction": "description",
    "transition": "CUT|DISSOLVE|FADE_IN|FADE_OUT"
  }
]`;

  let scenes = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await withRetry(() => model.generateContent(prompt), `EP${ep.id}`);
      const text = result.response.text();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('JSON 배열 없음');
      scenes = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(scenes) || scenes.length === 0) throw new Error('씬 배열이 비어있음');
      break;
    } catch (err) {
      console.warn(`   ⚠️ EP${ep.id} 시도 ${attempt + 1}/3 실패: ${err.message}`);
      if (attempt >= 2) { console.error(`   ❌ EP${ep.id} 스토리보드 생성 실패`); }
      else await new Promise(r => setTimeout(r, 5000));
    }
  }

  if (scenes) {
    scenes.forEach(s => {
      // ── Visual Anchor 1: Style Lock — 프롬프트 맨 앞에 작화 고정 앵커 삽입
      if (!s.visual_prompt_en.startsWith('(Showa retro anime')) {
        s.visual_prompt_en = STYLE_ANCHOR + ' ' + s.visual_prompt_en;
      }

      if (s.type === 'FLASHBACK' && charSeed) {
        // FLASHBACK: YOUNG_MOD + 나이 앵커 오버라이드 (항상 20s 앵커)
        const YOUNG_MOD = 'younger version of this character in their 20s-30s, (Young 20s smooth face, no wrinkles, youthful clear skin), energetic posture, ';
        s.visual_prompt_en = s.visual_prompt_en.replace(
          charSeed.trim(),
          charSeed.trim() + ' ' + YOUNG_MOD
        );
      } else if (charSeed) {
        // ── Visual Anchor 2: Age Lock — 캐릭터 시드 직후 나이 앵커 삽입
        const ageAnchor = getAgeAnchor(ep.character.age);
        const seedTrimmed = charSeed.trim();
        if (s.visual_prompt_en.includes(seedTrimmed) && !s.visual_prompt_en.includes('(Young 20s') && !s.visual_prompt_en.includes('(60s face') && !s.visual_prompt_en.includes('(30s face') && !s.visual_prompt_en.includes('(Middle-aged') && !s.visual_prompt_en.includes('(Deeply wrinkled')) {
          s.visual_prompt_en = s.visual_prompt_en.replace(
            seedTrimmed,
            seedTrimmed + ' ' + ageAnchor
          );
        }
      }

      allScenes.push({
        scene_id: sc(),
        episode_id: ep.id,
        speaker: `NARRATOR (${ep.character.name}・${ep.character.age})`,
        ...s,
      });
    });
    console.log(`   ✅ ${scenes.length}개 씬`);
  } else {
    console.warn(`   ⚠️  EP${ep.id} 파싱 실패`);
  }

  // DJ 리액션
  if (ep.dj_reaction) {
    allScenes.push(makeDJScene(ep.dj_reaction, 'reacting dramatically, steam effect, mono-eye pulsing red'));
  }

  // 트랜지션 멘트 (다음 에피소드 연결)
  if (ep.dj_transition) {
    allScenes.push(makeDJScene(ep.dj_transition, 'waving dismissively, turning to face camera'));

    // QA 코너 삽입 (EP2 트랜지션 직후)
    if (ep.id === 2 && hasQA) {
      console.log('   ➕ QA 코너 DJ_SHOT 씬 5개 삽입');
      const qaMotions = [
        'arms crossed, looking annoyed, mono-eye squinting suspiciously',
        'pointing finger accusingly at camera, jaw dropping in disbelief',
        'slapping forehead with metallic clang expression, exasperated pose',
        'leaning close to microphone intensely, mono-eye glowing bright',
        'shrugging with begrudging warmth, mono-eye softening slightly',
      ];
      qaMotions.forEach((motion, i) => {
        allScenes.push(makeDJScene(`即問即答コーナー — 質問${i + 1}`, motion));
      });
    }
  }

  await new Promise(r => setTimeout(r, 3000));
}

// ── 방송 엔딩
allScenes.push(makeDJScene(djScript.show_closing, 'leaning back warmly, mono-eye dimming gently, slow pan out', 'FADE_OUT'));

const totalDuration = allScenes.reduce((s, sc) => s + sc.duration_sec, 0);
const output = {
  total_scenes: allScenes.length,
  estimated_duration_sec: totalDuration,
  scenes: allScenes,
};

fs.writeFileSync(path.join(__dirname, '04_storyboard.json'), JSON.stringify(output, null, 2), 'utf-8');
console.log(`\n✅ 04_storyboard.json 저장 완료`);
console.log(`   총 ${output.total_scenes}씬 | 약 ${Math.floor(totalDuration / 60)}분 ${totalDuration % 60}초`);
if (hasQA) console.log(`   QA DJ_SHOT 5씬 포함됨`);
