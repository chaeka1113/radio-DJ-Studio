import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('❌ GEMINI_API_KEY 없음'); process.exit(1); }

const storyboard = JSON.parse(fs.readFileSync(path.join(__dirname, '04_storyboard.json'), 'utf-8'));
// flat 배열(신규) 또는 episodes[].scenes(구형) 모두 지원
const scenes = storyboard.scenes
  ?? storyboard.episodes?.flatMap(ep => (ep.scenes || []).map(s => ({ ...s, episode_id: ep.episode_id ?? ep.id })))
  ?? [];

const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

// Imagen 4.0 REST API
async function generateImageImagen3(prompt, negativePrompt) {
  const body = JSON.stringify({
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '16:9',
      safetyFilterLevel: 'BLOCK_ONLY_HIGH',
      personGeneration: 'ALLOW_ALL',
      negativePrompt: negativePrompt || GLOBAL_NEGATIVE,
    }
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/imagen-4.0-generate-001:predict?key=${API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`)); return; }
        const json = JSON.parse(data);
        const b64 = json.predictions?.[0]?.bytesBase64Encoded;
        if (!b64) { reject(new Error('이미지 데이터 없음')); return; }
        resolve(b64);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const STYLE_SUFFIX = ' Showa retro anime illustration, Studio Ghibli warm color palette, warm amber cinematic lighting, masterpiece, best quality, highly detailed, 8k.';

const GLOBAL_NEGATIVE = 'photorealistic, 3D render, realistic, real photo, photograph, hyperrealistic, modern style, cyberpunk, neon colors, glossy texture, plastic texture, abstract, moles, beauty marks, glasses, spectacles, nsfw, blurry, watermark, western features, square format, portrait format';

// 지수 백오프 재시도 (Imagen 4.0 only)
async function generateWithBackoff(prompt, negativePrompt, sceneId) {
  const BACKOFF_DELAYS = [30000, 60000, 120000];
  let lastErr;
  for (let attempt = 0; attempt <= BACKOFF_DELAYS.length; attempt++) {
    try {
      return await generateImageImagen3(prompt, negativePrompt);
    } catch (err) {
      lastErr = err;
      const is429 = err.message.includes('429') || err.message.toLowerCase().includes('quota');
      if (attempt < BACKOFF_DELAYS.length) {
        const waitMs = is429 ? BACKOFF_DELAYS[attempt] : 10000;
        console.warn(`   ⚠️ [${sceneId}] 시도 ${attempt + 1} 실패 (${err.message.slice(0, 60)})`);
        console.log(`   ⏳ ${waitMs / 1000}초 대기 후 Imagen 4.0 재시도...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }
  throw lastErr;
}

const results = [];
let success = 0, fail = 0;

console.log(`🖼️ 총 ${scenes.length}개 씬 이미지 생성 시작 (Imagen 4.0 전용)`);
console.log(`   예상 소요: 약 ${Math.ceil(scenes.length * 7 / 60)}분\n`);

for (let i = 0; i < scenes.length; i++) {
  const scene = scenes[i];
  const filePath = path.join(imagesDir, `${scene.scene_id}.png`);

  if (fs.existsSync(filePath)) {
    process.stdout.write(`⏭️  [${i+1}/${scenes.length}] ${scene.scene_id} 스킵\n`);
    results.push({ scene_id: scene.scene_id, status: 'skipped', file: filePath });
    continue;
  }

  const prompt = scene.visual_prompt_en + STYLE_SUFFIX;
  const negPrompt = scene.negative_prompt || GLOBAL_NEGATIVE;
  process.stdout.write(`🖼️  [${i+1}/${scenes.length}] ${scene.scene_id} (${scene.type})... `);

  try {
    const b64 = await generateWithBackoff(prompt, negPrompt, scene.scene_id);
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
    process.stdout.write(`✅\n`);
    results.push({ scene_id: scene.scene_id, status: 'success', file: filePath });
    success++;
  } catch (err) {
    process.stdout.write(`❌\n`);
    console.error(`   └ 최종 실패: ${err.message.slice(0, 100)}`);
    results.push({ scene_id: scene.scene_id, status: 'failed', error: err.message });
    fail++;
  }

  if (i < scenes.length - 1) await new Promise(r => setTimeout(r, 7000));
}

fs.writeFileSync(
  path.join(__dirname, '05_image_results.json'),
  JSON.stringify({ results, summary: { success, failed: fail } }, null, 2),
  'utf-8'
);
console.log(`\n=== 이미지 생성 완료 ===`);
console.log(`✅ 성공: ${success}개 | ❌ 실패: ${fail}개`);
console.log(`📁 .radio_output/images/`);
