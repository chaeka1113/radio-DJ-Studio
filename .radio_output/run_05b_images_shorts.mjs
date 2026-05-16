/**
 * run_05b_images_shorts.mjs — Q&A 씬 전용 9:16 Shorts 이미지 생성
 *
 * 스코프: qa_shot=true 씬만 대상
 * 출력:  .output/{EP_ID}/images_shorts/QASC001.png, QASC002.png, ...
 * 비율:  9:16 (세로형 포트레이트)
 * 크기:  1080×1920 강제 적용
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId  = process.env.EP_ID ?? generateEpId();
const P     = makePaths(epId);
ensureDirs(P);
const API_KEY = requireEnv('GEMINI_API_KEY');
const FORCE   = process.argv.includes('--force');
const singleQaArgIdx = process.argv.indexOf('--single-qa');
const SINGLE_QA = singleQaArgIdx >= 0 ? parseInt(process.argv[singleQaArgIdx + 1], 10) : null;
if (SINGLE_QA !== null && (isNaN(SINGLE_QA) || SINGLE_QA < 1 || SINGLE_QA > 5)) {
  console.error('❌ --single-qa N: N은 1~5 사이 정수');
  process.exit(1);
}

const IMAGE_MODEL  = 'gemini-2.5-flash-image';
const ASPECT_RATIO = '9:16';

// ── Shorts 전용 출력 폴더 ────────────────────────────────────────────────────
const IMAGE_SHORTS_DIR = path.join(P.base, 'images_shorts');
fs.mkdirSync(IMAGE_SHORTS_DIR, { recursive: true });

// ── 스토리보드에서 Q&A 씬만 추출 ──────────────────────────────────────────────
if (!fs.existsSync(P.storyboard)) {
  console.error('❌ 04_storyboard.json 없음 — run_04_storyboard.mjs 먼저 실행');
  process.exit(1);
}
const storyboard = JSON.parse(fs.readFileSync(P.storyboard, 'utf-8'));
const allScenes  = storyboard.scenes ?? [];
const qaScenes   = allScenes.filter(s => s.qa_shot === true);

if (qaScenes.length === 0) {
  console.error('❌ qa_shot=true 씬 없음 — --qa 플래그로 파이프라인을 실행하세요');
  process.exit(1);
}
console.log(`🎯 Q&A 씬: ${qaScenes.length}개 (전체 ${allScenes.length}개 중)${SINGLE_QA !== null ? ` — Q${SINGLE_QA} 단일 생성` : ''}`);

// ── DJ DNA (テンキ爺 고정) ───────────────────────────────────────────────────
const DJ_DNA = [
  'A consistent character named Tenki-jii: a battered retro tin robot DJ with a square boxy head,',
  'cracked silver paint with rust spots and dents, single glowing amber mono-eye lens,',
  'two bent antennae on top of head each with small colored flags attached,',
  'faded red chest panel with analog dials, gauges, and blinking indicator lights,',
  'worn silver mechanical arms with visible ball-joint connections and hydraulic tubes,',
  'always seated behind a vintage Showa-era wooden radio desk loaded with vinyl record stacks,',
  'old vacuum tube amplifiers, and a large retro microphone on a weighted stand.',
  'NEVER change: square boxy head shape, amber mono-eye, rust-spotted silver body, faded red chest panel, bent antennae.',
].join(' ');

// ── 9:16 세로형 스타일 ─────────────────────────────────────────────────────
const STYLE_BASE = [
  'Showa retro anime illustration in the style of Studio Ghibli hand-drawn animation.',
  'Warm color palette: amber, dusty rose, faded navy, sepia tones.',
  'Soft cinematic lighting with gentle film grain.',
  'Masterpiece quality, highly detailed, 8k resolution.',
  'COMPOSITION: Full bleed 9:16 vertical portrait frame. Rich detailed background MUST fill every pixel edge-to-edge.',
  'The character is centered in the upper-middle portion of the frame. Radio studio environment fills the rest.',
  'Absolutely NO black bars, NO letterboxing, NO pillarboxing, NO empty vignette edges, NO dark borders.',
  'The background scenery or environment must extend completely to all four corners of the frame.',
].join(' ');

const NO_TEXT_RULE = [
  'CRITICAL: Do NOT include ANY text, letters, words, subtitles, captions, labels,',
  'Japanese text, Chinese text, Korean text, Hangul, Kanji, Hiragana, Katakana,',
  'typography, font glyphs, writing, dialogue boxes, speech bubbles, or signs with readable text.',
  'The image must contain ZERO readable characters of any language.',
].join(' ');

const GLOBAL_NEGATIVE = [
  'photorealistic, 3D render, realistic photograph, hyperrealistic, CGI, modern style,',
  'cyberpunk, neon colors, glossy plastic texture, abstract, watermark,',
  'western facial features, text, letters, words, subtitles, captions,',
  'japanese text, chinese text, korean text, typography, font, writing,',
  'dialogue box, speech bubble, signs with text, black bars, letterbox, pillarbox.',
].join(' ');

// Q&A DJ 씬 전용 스타일: 세로 구도에서 캐릭터 강조
const DJ_SHOT_VERTICAL = [
  'Vertical portrait composition. テンキ爺 is prominently featured in the upper-center of the frame.',
  'Slightly closer crop than usual — chest/waist-up framing. Radio desk visible in lower portion.',
  'Dynamic angle, leaning slightly forward toward the microphone. Cozy amber-lit studio atmosphere.',
].join(' ');

// ── Gemini クライアント ─────────────────────────────────────────────────────
const ai = new GoogleGenAI({ apiKey: API_KEY });

// ── プロンプト構築 ──────────────────────────────────────────────────────────
function buildPrompt(scene) {
  const parts = [];

  parts.push('=== MAIN CHARACTER LOCK ===');
  parts.push(DJ_DNA);
  parts.push('LOCK — NEVER change: square boxy head shape, amber mono-eye, rust-spotted silver body.');
  parts.push('=== END MAIN CHARACTER LOCK ===', '');

  parts.push('=== SCENE DESCRIPTION ===');
  parts.push(DJ_SHOT_VERTICAL);
  if (scene.camera_direction) parts.push(`Camera framing: ${scene.camera_direction}.`);
  if (scene.japanese_dialogue?.trim()) {
    parts.push(`Emotional moment depicted: "${scene.japanese_dialogue.trim()}"`);
  }
  parts.push(scene.visual_prompt_en ?? 'テンキ爺 robot DJ in retro radio studio.');
  parts.push('=== END SCENE ===', '');

  parts.push('=== STYLE ===');
  parts.push(STYLE_BASE);
  parts.push('=== END STYLE ===', '');

  parts.push('=== FORBIDDEN ===');
  parts.push(NO_TEXT_RULE);
  const sceneNeg = scene.negative_prompt?.trim() ?? '';
  parts.push(`Also avoid: ${sceneNeg ? `${sceneNeg}, ` : ''}${GLOBAL_NEGATIVE}`);
  parts.push('=== END FORBIDDEN ===');

  return parts.join('\n');
}

function buildFallbackPrompt(scene) {
  const dialogue = scene.japanese_dialogue?.trim();
  const dialogueLine = dialogue ? `Emotional moment: "${dialogue}". ` : '';
  return [
    `${dialogueLine}${DJ_DNA} ${DJ_SHOT_VERTICAL} In a cozy Showa-era radio studio.`,
    STYLE_BASE,
    NO_TEXT_RULE,
    `Do NOT include: ${GLOBAL_NEGATIVE}`,
  ].join('\n');
}

// ── 이미지 생성 ─────────────────────────────────────────────────────────────
async function generateImage(promptText) {
  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ text: promptText }],
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: ASPECT_RATIO },
    },
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imgPart) throw new Error('이미지 데이터 없음');
  return imgPart.inlineData.data;
}

async function generateWithBackoff(promptText, sceneId, fallbackPrompt) {
  const DELAYS = [30000, 60000, 120000];
  let lastErr;
  const total = DELAYS.length + 1;
  for (let attempt = 0; attempt < total; attempt++) {
    const usePrompt = (fallbackPrompt && attempt === total - 1) ? fallbackPrompt : promptText;
    if (fallbackPrompt && attempt === total - 1) {
      console.log(`   🔄 [${sceneId}] 마지막 시도: 단순화 프롬프트`);
    }
    try {
      return await generateImage(usePrompt);
    } catch (err) {
      lastErr = err;
      const is429 = err.message.includes('429') || err.message.toLowerCase().includes('quota');
      if (attempt < DELAYS.length) {
        const wait = DELAYS[attempt];
        console.warn(`   ${is429 ? '🚨 Quota' : '⚠️  실패'} [${sceneId}] — ${wait / 1000}s 대기 (시도 ${attempt + 1}/${DELAYS.length})`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// ── ffmpeg 1080×1920 리사이즈 ───────────────────────────────────────────────
function resizeTo1080x1920(inputPath, outputPath) {
  const tmpPath = outputPath + '.tmp.png';
  // cropdetect → fill crop to 1080×1920
  let cropFilter = null;
  try {
    const detectOut = execSync(
      `ffmpeg -y -i "${inputPath}" -vf "cropdetect=limit=16:round=16:reset=0" -frames:v 1 -f null -`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const stderr = detectOut.toString();
    const match = stderr.match(/crop=(\d+:\d+:\d+:\d+)/);
    if (match) cropFilter = match[1];
  } catch (e) {
    const stderr = e.stderr?.toString() ?? '';
    const match = stderr.match(/crop=(\d+:\d+:\d+:\d+)/);
    if (match) cropFilter = match[1];
  }
  const vf = cropFilter
    ? `crop=${cropFilter},scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920`
    : `scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920`;
  execSync(
    `ffmpeg -y -i "${inputPath}" -vf "${vf}" -update 1 "${tmpPath}"`,
    { stdio: 'pipe' }
  );
  fs.renameSync(tmpPath, outputPath);
}

// ── 처리 대상 결정 ────────────────────────────────────────────────────────────
const sceneTargets = SINGLE_QA !== null
  ? [{
      scene:    qaScenes[(SINGLE_QA - 1) % qaScenes.length],
      fileName: `QASC${String(SINGLE_QA).padStart(3, '0')}001.png`,
      outDir:   path.join(IMAGE_SHORTS_DIR, `QA${SINGLE_QA}`),
      label:    `Q${SINGLE_QA} (single)`,
    }]
  : qaScenes.map((scene, i) => ({
      scene,
      fileName: `QASC${String(i + 1).padStart(3, '0')}.png`,
      outDir:   IMAGE_SHORTS_DIR,
      label:    `${i + 1}/${qaScenes.length}`,
    }));

// ── 메인 루프 ────────────────────────────────────────────────────────────────
const results = [];
let success = 0, fail = 0;

const firstDir = sceneTargets[0]?.outDir ?? IMAGE_SHORTS_DIR;
console.log(`\n📱 Shorts Q&A 이미지 생성 시작 (${sceneTargets.length}개, ${ASPECT_RATIO})`);
console.log(`   출력: ${firstDir}\n`);

for (let i = 0; i < sceneTargets.length; i++) {
  const { scene, fileName, outDir, label } = sceneTargets[i];
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, fileName);

  if (!FORCE && fs.existsSync(filePath)) {
    process.stdout.write(`⏭️  [${label}] ${fileName} 스킵\n`);
    results.push({ scene_id: scene.scene_id, file_name: fileName, status: 'skipped', file: filePath });
    continue;
  }

  process.stdout.write(`🖼️  [${label}] ${scene.scene_id} → ${fileName}... `);

  const promptText = buildPrompt(scene);
  const fallback   = buildFallbackPrompt(scene);

  try {
    const b64 = await generateWithBackoff(promptText, fileName, fallback);
    const rawPath = filePath + '.raw.png';
    fs.writeFileSync(rawPath, Buffer.from(b64, 'base64'));
    resizeTo1080x1920(rawPath, filePath);
    if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
    process.stdout.write(`✅\n`);
    results.push({ scene_id: scene.scene_id, file_name: fileName, status: 'success', file: filePath });
    success++;
  } catch (err) {
    process.stdout.write(`❌\n`);
    console.error(`   └ 실패: ${err.message.slice(0, 100)}`);
    results.push({ scene_id: scene.scene_id, file_name: fileName, status: 'failed', error: err.message });
    fail++;
  }

  if (i < sceneTargets.length - 1) await new Promise(r => setTimeout(r, 15000));
}

// 결과 저장
const resultsPath = path.join(P.base, '05b_shorts_image_results.json');
fs.writeFileSync(
  resultsPath,
  JSON.stringify({ results, summary: { success, failed: fail } }, null, 2),
  'utf-8'
);

console.log(`\n=== Shorts 이미지 생성 완료 ===`);
console.log(`✅ 성공: ${success}개 | ❌ 실패: ${fail}개`);
console.log(`📁 ${IMAGE_SHORTS_DIR}`);
