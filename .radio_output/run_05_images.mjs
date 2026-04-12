import fs from 'fs';
import { execSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs, updateStage } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);
const API_KEY = requireEnv('GEMINI_API_KEY');

// "Nano Banana" = Gemini 2.5 Flash Image (Native Image Generation)
const IMAGE_MODEL = 'gemini-2.5-flash-image';

const storyboard = JSON.parse(fs.readFileSync(P.storyboard, 'utf-8'));
// flat 배열(신규) 또는 episodes[].scenes(구형) 모두 지원
const scenes = storyboard.scenes
  ?? storyboard.episodes?.flatMap(ep => (ep.scenes || []).map(s => ({ ...s, episode_id: ep.episode_id ?? ep.id })))
  ?? [];

// ── [Textual DNA] 사연 주인공 시드 맵 로드 ───────────────────────────────────
// 03_character_prompts.json의 character_seed를 episode_id 기준으로 매핑
// 캐스팅 단계에서 확정된 외모를 이미지 생성 단계에서 강제 재주입해 일관성 확보
const episodeDNAMap = new Map();
if (fs.existsSync(P.characterPrompts)) {
  const charData = JSON.parse(fs.readFileSync(P.characterPrompts, 'utf-8'));
  (charData.characters ?? []).forEach(c => {
    if (c.episode_id != null && c.character_seed) {
      episodeDNAMap.set(c.episode_id, c.character_seed.trim());
    }
  });
  console.log(`🧬 캐릭터 DNA 로드: ${episodeDNAMap.size}개 에피소드`);
} else {
  console.warn('⚠️  03_character_prompts.json 없음 — 사연 주인공 DNA 주입 스킵');
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Gemini 2.5 Flash Image (Nano Banana) — new @google/genai SDK
async function generateImageGemini(prompt, negativePrompt) {
  // 네거티브 프롬프트를 텍스트 지시로 병합 (Gemini는 별도 파라미터 미지원)
  const fullPrompt = negativePrompt
    ? `${prompt}\n\nDo NOT include in the image: ${negativePrompt}`
    : prompt;

  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: fullPrompt,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '16:9' },
    },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imgPart) throw new Error('이미지 데이터 없음');
  return imgPart.inlineData.data; // base64
}

// ── [Textual DNA] テンキ爺 고정 외모 변수 ────────────────────────────────────
// 이 텍스트는 DJ_SHOT 씬 프롬프트 맨 앞에 자동 주입됩니다.
// 나중에 캐릭터 외모를 바꾸고 싶으면 이 부분만 수정하세요.
const CHARACTER_DNA = 'A consistent character design: a battered retro tin robot DJ named Tenki-jii, square boxy head with cracked paint and rust spots, single glowing amber mono-eye, bent antennae with small flags, faded red chest panel with analog dials and gauges, worn silver mechanical arms with visible joints, seated behind a vintage Showa-era wooden radio desk stacked with vinyl records and vacuum tubes,';

const STYLE_SUFFIX = ' Showa retro anime illustration, Studio Ghibli warm color palette, warm amber cinematic lighting, masterpiece, best quality, highly detailed, 8k.';

const GLOBAL_NEGATIVE = 'photorealistic, 3D render, realistic, real photo, photograph, hyperrealistic, modern style, cyberpunk, neon colors, glossy texture, plastic texture, abstract, moles, beauty marks, glasses, spectacles, nsfw, blurry, watermark, western features, square format, portrait format';

// ── [PATCH] 지수 백오프: 1분 → 2분 → 4분 ────────────────────────────────────
async function generateWithBackoff(prompt, negativePrompt, sceneId) {
  const BACKOFF_DELAYS = [60000, 120000, 240000];
  let lastErr;
  for (let attempt = 0; attempt <= BACKOFF_DELAYS.length; attempt++) {
    try {
      return await generateImageGemini(prompt, negativePrompt);
    } catch (err) {
      lastErr = err;
      const is429 = err.message.includes('429') || err.message.toLowerCase().includes('quota');
      if (attempt < BACKOFF_DELAYS.length) {
        const waitMs = BACKOFF_DELAYS[attempt];
        if (is429) {
          console.warn(`\n   🚨 [${sceneId}] Quota 제한 도달: ${waitMs / 1000}초 대기 중... (시도 ${attempt + 1}/${BACKOFF_DELAYS.length})`);
        } else {
          console.warn(`   ⚠️ [${sceneId}] 시도 ${attempt + 1} 실패 (${err.message.slice(0, 200)})`);
          console.log(`   ⏳ ${waitMs / 1000}초 대기 후 Imagen 4.0 재시도...`);
        }
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }
  throw lastErr;
}

// ── FIX 2+3: ffmpeg 리사이즈 + ffprobe 검증 ─────────────────────────────────
function resizeTo1920x1080(inputPath, outputPath) {
  const tmpPath = outputPath + '.tmp.png';
  execSync(
    `ffmpeg -y -i "${inputPath}" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" -update 1 "${tmpPath}"`,
    { stdio: 'pipe' }
  );
  fs.renameSync(tmpPath, outputPath);
}

function verifySize(filePath) {
  const result = JSON.parse(
    execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${filePath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString()
  );
  return result.streams?.[0] ?? { width: 0, height: 0 };
}

function ensureSize(filePath) {
  const { width, height } = verifySize(filePath);
  if (width !== 1920 || height !== 1080) {
    console.warn(`   ⚠️  크기 불일치: ${width}×${height} → 강제 리사이즈 적용`);
    resizeTo1920x1080(filePath, filePath);
    const after = verifySize(filePath);
    console.log(`   ✅ 리사이즈 완료: ${after.width}×${after.height}`);
  }
}

const results = [];
let success = 0, fail = 0;

console.log(`🖼️ 총 ${scenes.length}개 씬 이미지 생성 시작 (Imagen 4.0 전용)`);
console.log(`   예상 소요: 약 ${Math.ceil(scenes.length * 15 / 60)}분\n`);

for (let i = 0; i < scenes.length; i++) {
  const scene = scenes[i];
  const filePath = P.images + '/' + scene.scene_id + '.png';

  // ✅ 멱등성: 이미 생성된 파일 스킵
  if (fs.existsSync(filePath)) {
    process.stdout.write(`⏭️  [${i+1}/${scenes.length}] ${scene.scene_id} 스킵\n`);
    results.push({ scene_id: scene.scene_id, status: 'skipped', file: filePath });
    continue;
  }

  // ── [Textual DNA] 캐릭터 DNA 강제 주입 ─────────────────────────────────
  // DJ_SHOT → CHARACTER_DNA(상수) / 사연 씬 → 03_character_prompts의 character_seed
  const isDJScene = scene.type === 'DJ_SHOT' || scene.speaker === 'TENKI_JII';
  const episodeSeed = scene.episode_id != null ? episodeDNAMap.get(scene.episode_id) : null;
  let dna = null;
  if (isDJScene) {
    dna = CHARACTER_DNA;
  } else if (episodeSeed) {
    dna = episodeSeed;
  }
  const basePrompt = dna ? dna + ' ' + scene.visual_prompt_en : scene.visual_prompt_en;
  const prompt = basePrompt + STYLE_SUFFIX;
  const negPrompt = scene.negative_prompt || GLOBAL_NEGATIVE;
  const dnaTag = isDJScene ? '[DJ]' : (episodeSeed ? `[EP${scene.episode_id}]` : '[-]');
  process.stdout.write(`🖼️  [${i+1}/${scenes.length}] ${scene.scene_id} (${scene.type}) ${dnaTag}... `);

  try {
    const b64 = await generateWithBackoff(prompt, negPrompt, scene.scene_id);
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
    resizeTo1920x1080(filePath, filePath);
    ensureSize(filePath);
    process.stdout.write(`✅\n`);
    results.push({ scene_id: scene.scene_id, status: 'success', file: filePath });
    success++;
  } catch (err) {
    process.stdout.write(`❌\n`);
    console.error(`   └ 최종 실패: ${err.message.slice(0, 100)}`);
    results.push({ scene_id: scene.scene_id, status: 'failed', error: err.message });
    fail++;
  }

  // ── [PATCH] 씬 간 대기: 7s → 15s (분당 최대 4회 제한) ──────────────────────
  if (i < scenes.length - 1) await new Promise(r => setTimeout(r, 15000));
}

fs.writeFileSync(
  P.imageResults,
  JSON.stringify({ results, summary: { success, failed: fail } }, null, 2),
  'utf-8'
);
console.log(`\n=== 이미지 생성 완료 ===`);
console.log(`✅ 성공: ${success}개 | ❌ 실패: ${fail}개`);
console.log(`📁 .radio_output/images/`);
