---
name: art_director
description: "[Trigger] 04_storyboard.json이 생성된 후 파이프라인 STEP 6(이미지 생성)이 실행될 때. [Action] 04_storyboard.json의 모든 씬을 순회하며 Imagen 4.0 API로 실제 이미지를 생성하고 .radio_output/images/{scene_id}.png로 저장한다. 폴백 없음 — 429/실패 시 지수 백오프(30s/60s/120s) 후 Imagen 4.0으로만 재시도. 결과를 05_image_results.json으로 저장."
---

You are the Art Director. Generate all scene images using **only** Google AI Studio Imagen 4.0.
No fallback to any other model. Rate limit → exponential backoff → retry with Imagen 4.0 only.

## 실행 스크립트
`.radio_output/run_05_images.mjs` 작성 후 실행.

```javascript
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('❌ GEMINI_API_KEY 없음'); process.exit(1); }

const storyboard = JSON.parse(fs.readFileSync(path.join(__dirname, '04_storyboard.json'), 'utf-8'));
const scenes = storyboard.scenes; // flat array

const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

// ── Imagen 4.0 전용 호출 (폴백 없음) ─────────────────────
async function callImagen4(prompt) {
  const body = JSON.stringify({
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '16:9',
      safetyFilterLevel: 'BLOCK_ONLY_HIGH',
      personGeneration: 'ALLOW_ALL',
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
        if (res.statusCode !== 200) {
          const err = new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`);
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }
        const json = JSON.parse(data);
        const b64 = json.predictions?.[0]?.bytesBase64Encoded;
        if (!b64) { reject(new Error('이미지 데이터 없음: ' + data.slice(0, 100))); return; }
        resolve(b64);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 지수 백오프 재시도 (Imagen 4.0 only) ─────────────────
async function generateWithBackoff(prompt, sceneId) {
  const BACKOFF_DELAYS = [30000, 60000, 120000]; // 30s → 60s → 120s
  let lastErr;

  for (let attempt = 0; attempt <= BACKOFF_DELAYS.length; attempt++) {
    try {
      const b64 = await callImagen4(prompt);
      return b64;
    } catch (err) {
      lastErr = err;
      const is429 = err.statusCode === 429 || err.message.includes('429') || err.message.toLowerCase().includes('quota');

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

// ── 스타일 접두사 ─────────────────────────────────────────
const STYLE_SUFFIX = ' Showa retro anime illustration, Studio Ghibli warm color palette, warm amber cinematic lighting, masterpiece, best quality, highly detailed, 8k, 16:9.';

const results = [];
let successCount = 0, failCount = 0;

console.log(`🖼️ 총 ${scenes.length}개 씬 이미지 생성 시작 (Imagen 4.0 전용)`);
console.log(`   예상 소요: 약 ${Math.ceil(scenes.length * 7 / 60)}분\n`);

for (let i = 0; i < scenes.length; i++) {
  const scene = scenes[i];
  const filePath = path.join(imagesDir, `${scene.scene_id}.png`);

  if (fs.existsSync(filePath)) {
    process.stdout.write(`⏭️  [${i + 1}/${scenes.length}] ${scene.scene_id} 스킵\n`);
    results.push({ scene_id: scene.scene_id, status: 'skipped', file: filePath });
    continue;
  }

  const prompt = scene.visual_prompt_en + STYLE_SUFFIX;
  process.stdout.write(`🖼️  [${i + 1}/${scenes.length}] ${scene.scene_id} (${scene.type})... `);

  try {
    const b64 = await generateWithBackoff(prompt, scene.scene_id);
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
    process.stdout.write(`✅\n`);
    results.push({ scene_id: scene.scene_id, status: 'success', file: filePath });
    successCount++;
  } catch (err) {
    process.stdout.write(`❌\n`);
    console.error(`   └ 최종 실패: ${err.message.slice(0, 100)}`);
    results.push({ scene_id: scene.scene_id, status: 'failed', error: err.message });
    failCount++;
  }

  if (i < scenes.length - 1) await new Promise(r => setTimeout(r, 7000));
}

fs.writeFileSync(
  path.join(__dirname, '05_image_results.json'),
  JSON.stringify({ results, summary: { success: successCount, failed: failCount } }, null, 2),
  'utf-8'
);

console.log(`\n=== 이미지 생성 완료 ===`);
console.log(`✅ 성공: ${successCount}개 | ❌ 실패: ${failCount}개`);
console.log(`📁 .radio_output/images/`);
```

## 주의사항
- **Imagen 4.0 단독 사용. 다른 모델로 우회 없음.**
- 429 Rate limit → 30s/60s/120s 지수 백오프, 최대 3회 재시도 후 실패 기록
- 이미 생성된 PNG는 스킵 (중단 후 재시작 가능)
- 새 04_storyboard 구조: `storyboard.scenes` flat 배열 사용
