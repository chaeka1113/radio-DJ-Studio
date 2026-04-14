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

// ── 모델 설정 ─────────────────────────────────────────────────────────────────
// gemini-2.5-flash-image: 저비용 고품질. imageSize 미지원, aspectRatio만 사용.
const IMAGE_MODEL  = 'gemini-2.5-flash-image';
const ASPECT_RATIO = '16:9';

// ── 스토리보드 로드 ───────────────────────────────────────────────────────────
const storyboard = JSON.parse(fs.readFileSync(P.storyboard, 'utf-8'));
const scenes = storyboard.scenes
  ?? storyboard.episodes?.flatMap(ep => (ep.scenes || []).map(s => ({ ...s, episode_id: ep.episode_id ?? ep.id })))
  ?? [];

// ── 캐릭터 DNA 맵 (03_character_prompts.json) ────────────────────────────────
// episodeDNAMap    : epId → 주인공 character_seed (string)
// episodeSecondary : epId → [{ character_key, character_seed, detection_keywords[] }]
const episodeDNAMap    = new Map();
const episodeSecondary = new Map();

if (fs.existsSync(P.characterPrompts)) {
  const charData = JSON.parse(fs.readFileSync(P.characterPrompts, 'utf-8'));
  (charData.characters ?? []).forEach(c => {
    if (c.episode_id == null) return;
    if (c.character_seed) {
      episodeDNAMap.set(c.episode_id, c.character_seed.trim());
    }
    if (Array.isArray(c.secondary_characters) && c.secondary_characters.length > 0) {
      episodeSecondary.set(c.episode_id, c.secondary_characters.map(sc => ({
        character_key:      sc.character_key,
        character_name:     sc.character_name ?? sc.character_key,
        role:               sc.role ?? '',
        character_seed:     (sc.character_seed ?? '').trim(),
        detection_keywords: Array.isArray(sc.detection_keywords) ? sc.detection_keywords : [],
      })));
    }
  });
  const secCount = [...episodeSecondary.values()].reduce((s, arr) => s + arr.length, 0);
  console.log(`🧬 캐릭터 DNA 로드: 주인공 ${episodeDNAMap.size}개 에피소드, 보조 ${secCount}명`);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// ── テンキ爺 고정 DNA ─────────────────────────────────────────────────────────
// 캐릭터 일관성을 위해 모든 DJ씬에 동일한 외형 잠금 설명 사용
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

// ── 共通スタイル指示 ──────────────────────────────────────────────────────────
const STYLE_BASE = [
  'Showa retro anime illustration in the style of Studio Ghibli hand-drawn animation.',
  'Warm color palette: amber, dusty rose, faded navy, sepia tones.',
  'Soft cinematic lighting with gentle film grain.',
  'Masterpiece quality, highly detailed, 8k resolution.',
].join(' ');

const NO_TEXT_RULE = [
  'CRITICAL: Do NOT include ANY text, letters, words, subtitles, captions, labels,',
  'Japanese text, Chinese text, Korean text, Hangul, Kanji, Hiragana, Katakana,',
  'typography, font glyphs, writing, dialogue boxes, speech bubbles, or signs with readable text.',
  'The image must contain ZERO readable characters of any language.',
].join(' ');

const GLOBAL_NEGATIVE = [
  'photorealistic, 3D render, realistic photograph, hyperrealistic, CGI, modern style,',
  'cyberpunk, neon colors, glossy plastic texture, abstract, moles, beauty marks,',
  'glasses, spectacles, nsfw, blurry background on main subject, watermark,',
  'western facial features, text, letters, words, subtitles, captions,',
  'japanese text, chinese text, korean text, typography, font, writing,',
  'dialogue box, speech bubble, signs with text.',
].join(' ');

// ── 씬 타입별 촬영 스타일 ─────────────────────────────────────────────────────
const SCENE_TYPE_STYLE = {
  ESTABLISHING:    'Wide establishing shot with expansive scenery. Characters are small figures in the environment. Focus on atmosphere and setting.',
  CHARACTER_SCENE: 'Medium shot framing character from waist up. Expressive face and body language clearly visible.',
  CLOSE_UP:        'Extreme close-up shot on the character\'s face. Intense emotional expression. Shallow depth of field with eyes in sharp focus.',
  FLASHBACK:       'Soft warm sepia color grading with desaturated nostalgic tone. Gentle vignette around edges. Dreamlike soft focus atmosphere. Faded film look.',
  DJ_SHOT:         'Medium studio shot with the vintage radio desk prominent in the foreground. Cozy amber-lit studio atmosphere with warm back lighting.',
};

// ── CHARACTER LOCK 블록 생성 ──────────────────────────────────────────────────
// 주인공 / 보조 캐릭터 모두 동일한 섹션 구조로 주입
// isFlashback=true 이면 주인공을 젊은 시절 버전으로 오버라이드
function buildMainCharLock(dna, isFlashback) {
  if (!dna) return '';

  if (isFlashback) {
    return [
      '=== MAIN CHARACTER (YOUNGER VERSION — FLASHBACK) ===',
      'Base appearance reference:',
      dna,
      'FLASHBACK OVERRIDES — render this character as their younger self:',
      '  - Smooth youthful face, absolutely no wrinkles',
      '  - Thick dark hair without any gray',
      '  - Energetic upright posture, bright alert eyes',
      '  - Same general face structure but decades younger',
      '=== END MAIN CHARACTER ===',
    ].join('\n');
  }

  return [
    '=== MAIN CHARACTER LOCK (KEEP IDENTICAL ACROSS ALL SCENES) ===',
    dna,
    'LOCK — NEVER change these attributes:',
    '  - Face structure, wrinkle pattern, expression lines',
    '  - Hair color, length, and styling',
    '  - Clothing outfit as described above',
    '  - Body proportions and posture',
    '=== END MAIN CHARACTER LOCK ===',
  ].join('\n');
}

function buildSecondaryCharLock(secChar) {
  if (!secChar.character_seed) return '';
  return [
    `=== SECONDARY CHARACTER: ${secChar.character_name} (${secChar.role}) ===`,
    secChar.character_seed,
    `LOCK — render ${secChar.character_name} with IDENTICAL appearance in every scene they appear:`,
    '  - Same face, hair, clothing, and body proportions as described above',
    '  - Maintain consistent visual identity; do NOT blend with other characters',
    `=== END SECONDARY CHARACTER: ${secChar.character_name} ===`,
  ].join('\n');
}

// ── 씬에 등장하는 보조 캐릭터 감지 ─────────────────────────────────────────
// visual_prompt_en 안에 detection_keywords 중 하나라도 포함되면 해당 캐릭터 매칭
function detectSecondaryChars(scene, epId) {
  const secondary = episodeSecondary.get(epId) ?? [];
  if (secondary.length === 0) return [];

  const haystack = (scene.visual_prompt_en ?? '').toLowerCase();
  return secondary.filter(sc =>
    sc.detection_keywords.some(kw => haystack.includes(kw.toLowerCase()))
  );
}

// ── プロンプト構築 ─────────────────────────────────────────────────────────────
// 構造: [主人公LOCK] [보조캐릭터LOCK...] [SCENE] [STYLE] [FORBIDDEN]
function buildPrompt(scene, dna, epId) {
  const isFlashback = scene.type === 'FLASHBACK';

  // 주인공 CHARACTER LOCK
  const mainLock = buildMainCharLock(dna, isFlashback);

  // 보조 캐릭터 CHARACTER LOCK (감지된 것만)
  const matchedSecondary = detectSecondaryChars(scene, epId);
  const secondaryLocks = matchedSecondary
    .map(sc => buildSecondaryCharLock(sc))
    .filter(Boolean);

  // 씬 구성
  const typeStyle   = SCENE_TYPE_STYLE[scene.type] ?? '';
  const cameraCtx   = scene.camera_direction ? `Camera framing: ${scene.camera_direction}.` : '';
  const dialogue    = scene.japanese_dialogue?.trim();
  const dialogueCtx = dialogue ? `The scene depicts this emotional moment: "${dialogue}"` : '';
  const sceneDesc   = scene.visual_prompt_en ?? '';

  // 네거티브
  const sceneNeg   = scene.negative_prompt?.trim() ?? '';
  const combinedNeg = sceneNeg ? `${sceneNeg}, ${GLOBAL_NEGATIVE}` : GLOBAL_NEGATIVE;

  // 조립
  const parts = [];

  if (mainLock) parts.push(mainLock, '');

  if (secondaryLocks.length > 0) {
    secondaryLocks.forEach(lock => parts.push(lock, ''));
    parts.push(
      `NOTE: This scene features ${matchedSecondary.length + (dna ? 1 : 0)} characters.`,
      'Each character must be visually DISTINCT — do NOT mix or merge their appearances.',
      ''
    );
  }

  parts.push('=== SCENE DESCRIPTION ===');
  if (typeStyle)   parts.push(typeStyle);
  if (cameraCtx)   parts.push(cameraCtx);
  if (dialogueCtx) parts.push(dialogueCtx);
  parts.push(sceneDesc);
  parts.push('=== END SCENE ===', '');

  parts.push('=== STYLE ===');
  parts.push(STYLE_BASE);
  parts.push('=== END STYLE ===', '');

  parts.push('=== FORBIDDEN ===');
  parts.push(NO_TEXT_RULE);
  parts.push(`Also avoid: ${combinedNeg}`);
  parts.push('=== END FORBIDDEN ===');

  return parts.join('\n');
}

// ── フォールバックプロンプト (最終リトライ用・シンプル化) ─────────────────────
function buildFallbackPrompt(scene, dna) {
  const typeStyle = SCENE_TYPE_STYLE[scene.type] ?? 'Medium shot,';
  const base = dna
    ? `${dna} ${typeStyle} A single character in a warm Japanese interior setting.`
    : `${typeStyle} A cozy Japanese living room scene.`;
  const dialogue = scene.japanese_dialogue?.trim();
  const dialogueCtx = dialogue ? `Emotional moment: "${dialogue}". ` : '';
  return [
    `${dialogueCtx}${base}`,
    STYLE_BASE,
    NO_TEXT_RULE,
    `Do NOT include: ${GLOBAL_NEGATIVE}`,
  ].join('\n');
}

// ── 이미지 생성 (텍스트 프롬프트만 사용) ─────────────────────────────────────
// gemini-2.5-flash-image: imageSize 미지원, aspectRatio만 가능
async function generateImage(promptText) {
  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ text: promptText }],
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: ASPECT_RATIO,
      },
    },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imgPart) throw new Error('이미지 데이터 없음');
  return imgPart.inlineData.data; // base64
}

// ── 지수 백오프 재시도 ────────────────────────────────────────────────────────
async function generateWithBackoff(promptText, sceneId, fallbackPrompt = null) {
  const BACKOFF_DELAYS = [30000, 60000, 120000];
  let lastErr;
  const totalAttempts = BACKOFF_DELAYS.length + 1; // 최대 4회

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    // 마지막 시도에서 fallback 프롬프트로 교체
    const usePrompt = (fallbackPrompt && attempt === totalAttempts - 1)
      ? fallbackPrompt
      : promptText;
    if (fallbackPrompt && attempt === totalAttempts - 1) {
      console.log(`   🔄 [${sceneId}] 마지막 시도: 단순화 프롬프트로 재시도...`);
    }

    try {
      return await generateImage(usePrompt);
    } catch (err) {
      lastErr = err;
      const is429 = err.message.includes('429')
        || err.message.toLowerCase().includes('quota')
        || err.message.toLowerCase().includes('resource_exhausted');
      if (attempt < BACKOFF_DELAYS.length) {
        const waitMs = BACKOFF_DELAYS[attempt];
        if (is429) {
          console.warn(`\n   🚨 [${sceneId}] Quota 도달: ${waitMs / 1000}초 대기... (시도 ${attempt + 1}/${BACKOFF_DELAYS.length})`);
        } else {
          console.warn(`   ⚠️  [${sceneId}] 시도 ${attempt + 1} 실패: ${err.message.slice(0, 200)}`);
          console.log(`   ⏳ ${waitMs / 1000}초 대기 후 재시도...`);
        }
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }
  throw lastErr;
}

// ── ffmpeg 리사이즈 + 검증 ────────────────────────────────────────────────────
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
    console.warn(`   ⚠️  크기 불일치: ${width}×${height} → 강제 리사이즈`);
    resizeTo1920x1080(filePath, filePath);
  }
}

// ── 메인 루프 ─────────────────────────────────────────────────────────────────
const results = [];
let success = 0, fail = 0;

console.log(`🖼️  총 ${scenes.length}개 씬 이미지 생성 시작 (${IMAGE_MODEL})`);
console.log(`   비율: ${ASPECT_RATIO} | 캐릭터 일관성: DNA 텍스트 잠금 방식\n`);

for (let i = 0; i < scenes.length; i++) {
  const scene = scenes[i];
  const filePath = P.images + '/' + scene.scene_id + '.png';

  // 멱등성: 이미 생성된 파일 스킵
  if (fs.existsSync(filePath)) {
    process.stdout.write(`⏭️  [${i+1}/${scenes.length}] ${scene.scene_id} 스킵\n`);
    results.push({ scene_id: scene.scene_id, status: 'skipped', file: filePath });
    continue;
  }

  // ── DNA 결정 ────────────────────────────────────────────────────────────────
  const isDJ = scene.type === 'DJ_SHOT' || scene.speaker === 'TENKI_JII';
  const dna = isDJ
    ? DJ_DNA
    : (scene.episode_id != null ? episodeDNAMap.get(scene.episode_id) ?? null : null);

  const matchedSec = detectSecondaryChars(scene, scene.episode_id);
  const secTag = matchedSec.length > 0 ? `+${matchedSec.map(s => s.character_key).join(',')}` : '';
  const refTag = isDJ ? '[DJ]' : (dna ? `[EP${scene.episode_id}${secTag}]` : '[-]');
  process.stdout.write(`🖼️  [${i+1}/${scenes.length}] ${scene.scene_id} (${scene.type}) ${refTag}... `);

  const promptText = buildPrompt(scene, dna, scene.episode_id);
  const fallback   = buildFallbackPrompt(scene, dna);

  try {
    const b64 = await generateWithBackoff(promptText, scene.scene_id, fallback);
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

  // 씬 간 대기: 유료 플랜 기준 15초 (분당 ~4회)
  if (i < scenes.length - 1) await new Promise(r => setTimeout(r, 15000));
}

fs.writeFileSync(
  P.imageResults,
  JSON.stringify({ results, summary: { success, failed: fail } }, null, 2),
  'utf-8'
);
console.log(`\n=== 이미지 생성 완료 ===`);
console.log(`✅ 성공: ${success}개 | ❌ 실패: ${fail}개`);
console.log(`📁 images/`);
