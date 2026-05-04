/**
 * regen_scenes.mjs
 * 특정 씬만 프롬프트 수정 후 재생성.
 * 사용: EP_ID=EP_3_youtube node .radio_output/regen_scenes.mjs
 */

import fs   from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId   = process.env.EP_ID ?? generateEpId();
const P      = makePaths(epId);
ensureDirs(P);
const API_KEY = requireEnv('GEMINI_API_KEY');

const IMAGE_MODEL  = 'gemini-2.5-flash-image';
const ASPECT_RATIO = '16:9';

const ai = new GoogleGenAI({ apiKey: API_KEY });

// ── 씬별 프롬프트 패치 정의 ───────────────────────────────────────────────────
// visual_prompt_en / negative_prompt / camera_direction 를 덮어씀
const SCENE_PATCHES = {

  // SC025: 이미 수정 완료 — 필요 시 주석 해제
  /*
  SC025: {
    // Case A: 캐릭터가 폰을 보고 있음 → 뒷면이 카메라 방향
    // 규칙: plain matte back panel, screen glow illuminates face
    visual_prompt_en: `(Showa retro anime, Studio Ghibli style hand-drawn illustration), Middle-aged Japanese man in his late 50s, stocky build with slightly rounded shoulders from desk work, clean smooth face with natural aging features showing visible nasolabial folds and forehead lines, tired gentle eyes with slight bags underneath, short black hair with scattered gray strands combed neatly to the side, clean-shaven with square jawline, wearing a wrinkled beige business shirt with sleeves rolled up to elbows and dark gray work slacks, slightly hunched posture conveying exhaustion and emotional weight, earnest worried expression with furrowed brows. (Middle-aged face, visible laugh lines, mature look). The man holds a smartphone upright in both hands, intently looking down at the screen (screen facing toward him, away from camera). Camera sees the PLAIN MATTE BACK PANEL of the smartphone — smooth dark back cover with only 1-2 small circular camera lenses visible, absolutely NO display or glow on the back panel. The front screen's blue-white light spills around the edges and illuminates his anxious face from below, casting soft upward shadows. He sits hunched at a small low home table, a tea cup beside him. Showa retro anime illustration, Studio Ghibli warm palette, masterpiece, best quality, highly detailed, 8k, cinematic, 16:9`,
    negative_prompt: `screen on back panel, display on back cover, rear screen, glowing back of device, transparent back panel, screen visible on the side facing camera, modern style, cyberpunk, neon colors, glossy texture, plastic texture, abstract, photorealistic, 3D render, nsfw, blurry, watermark, western features, moles, beauty marks, glasses, spectacles`,
    camera_direction: `Medium shot from front-right angle. Camera sees the character's face lit from below by the phone's glow, and the plain matte back of the phone facing the viewer.`,
  },
  */

  SC066: {
    // Case A: 캐릭터 → TV → 카메라 순서
    // 카메라는 TV 뒤에서 찍음 → TV 뒷면(백패널)만 보임
    // TV 화면은 캐릭터를 향하고 있어 카메라에 보이지 않음
    // 캐릭터 얼굴은 TV 화면 빛을 정면으로 받아 밝게 빛남
    visual_prompt_en: `(Showa retro anime, Studio Ghibli style hand-drawn illustration), Japanese man in his late 60s with a stocky build and slightly rounded shoulders, gentle oval face with deep smile lines around the eyes and mouth, warm brown eyes wide with alarm, short salt-and-pepper hair neatly combed to the side, wearing a well-worn beige cardigan over a faded checkered shirt, practical dark slacks, sitting frozen upright on tatami in shock. (60s face, clear deep wrinkles, salt-and-pepper or gray hair). Camera is positioned DIRECTLY BEHIND the small vintage CRT television set — the camera sees only the TV's PLAIN MATTE BACK PANEL: dull gray-brown plastic rear cover with ventilation slots and a few cable ports, absolutely NO screen or display visible on the back. Beyond the TV, the elderly man sits on the tatami floor with his face fully illuminated by the strong blue-white glow coming from the TV screen in front of him (screen faces him, away from camera). His alarmed expression — wide eyes, mouth slightly open — is lit dramatically from the front by the TV's light. Morning light filters through shoji screens in the background. Showa retro anime illustration, Studio Ghibli warm palette, masterpiece, best quality, highly detailed, 8k, cinematic, 16:9`,
    negative_prompt: `screen on back of TV, display on TV back panel, glowing TV back, TV screen facing camera, weather graphics visible to camera, rear TV screen, modern style, cyberpunk, neon colors, glossy texture, plastic texture, abstract, photorealistic, 3D render, realistic, nsfw, blurry, watermark, western features, moles, beauty marks, glasses, spectacles`,
    camera_direction: `Camera positioned BEHIND the TV, looking past the TV's plain back panel toward the character. The TV back panel occupies the lower-center foreground. The character's face in the background is brightly front-lit by the TV screen's glow (screen faces away from camera toward character).`,
  },

};

// ── 공통 스타일 상수 (run_05와 동일) ─────────────────────────────────────────
const STYLE_BASE = [
  'Showa retro anime illustration in the style of Studio Ghibli hand-drawn animation.',
  'Warm color palette: amber, dusty rose, faded navy, sepia tones.',
  'Soft cinematic lighting with gentle film grain.',
  'Masterpiece quality, highly detailed, 8k resolution.',
  'COMPOSITION: Full bleed 16:9 wide frame. Rich detailed background MUST fill every pixel edge-to-edge.',
  'Absolutely NO black bars, NO letterboxing, NO pillarboxing, NO empty vignette edges, NO dark borders.',
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
  'western facial features, text, letters, words, subtitles, captions.',
].join(' ');

// ── 이미지 생성 ───────────────────────────────────────────────────────────────
async function generateImage(prompt) {
  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ text: prompt }],
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

function resizeTo1920x1080(inputPath, outputPath) {
  execSync(
    `ffmpeg -y -i "${inputPath}" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black" "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

async function withBackoff(fn, sceneId) {
  const delays = [30000, 60000, 120000];
  for (let i = 0; i <= delays.length; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === delays.length) throw err;
      console.warn(`  ⚠ [${sceneId}] 시도 ${i+1} 실패: ${err.message.slice(0,120)}`);
      console.log(`  ⏳ ${delays[i]/1000}초 대기...`);
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
const storyboard = JSON.parse(fs.readFileSync(P.storyboard, 'utf-8'));

for (const [sceneId, patch] of Object.entries(SCENE_PATCHES)) {
  console.log(`\n▶ ${sceneId} 재생성 중...`);

  // 스토리보드 씬 찾아서 패치
  const scene = storyboard.scenes.find(s => s.scene_id === sceneId);
  if (!scene) { console.error(`  ❌ 씬 없음: ${sceneId}`); continue; }

  Object.assign(scene, patch);

  // 프롬프트 조립
  const neg = `${patch.negative_prompt}, ${GLOBAL_NEGATIVE}`;
  const prompt = [
    '=== SCENE DESCRIPTION ===',
    patch.camera_direction ? `Camera framing: ${patch.camera_direction}` : '',
    patch.visual_prompt_en,
    '=== END SCENE ===',
    '',
    '=== STYLE ===',
    STYLE_BASE,
    '=== END STYLE ===',
    '',
    '=== FORBIDDEN ===',
    NO_TEXT_RULE,
    `Also avoid: ${neg}`,
    '=== END FORBIDDEN ===',
  ].filter(Boolean).join('\n');

  // 생성
  const imgPath  = path.join(P.images, `${sceneId}.png`);
  const tmpPath  = imgPath + '.tmp.png';

  const b64 = await withBackoff(() => generateImage(prompt), sceneId);
  fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
  resizeTo1920x1080(tmpPath, imgPath);
  fs.unlinkSync(tmpPath);

  console.log(`  ✅ 저장: ${imgPath}`);
}

// 스토리보드 패치 저장 (프롬프트 기록 보존)
fs.writeFileSync(P.storyboard, JSON.stringify(storyboard, null, 2), 'utf-8');
console.log('\n📋 storyboard 패치 저장 완료');
console.log('\n🎨 재생성 완료 — CapCut에서 새 이미지가 자동 반영됩니다.');
