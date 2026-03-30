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

const imageResults = JSON.parse(fs.readFileSync(path.join(__dirname, '05_image_results.json'), 'utf-8'));

const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

// 씬 타입별 모션 프롬프트
const MOTION_TEMPLATES = {
  DJ_SHOT: 'subtle robotic mechanical trembling, antenna wobbling, vacuum tube flickering with amber glow, static electricity sparks, locked camera, no sudden movements',
  CHARACTER_SCENE: 'gentle breathing movement, soft hair sway in breeze, micro facial expressions showing emotion, slow subtle zoom in 2%, film grain overlay',
  ESTABLISHING: 'slow cinematic pan from right to left, golden hour light shift, leaves gently falling, peaceful ambient atmosphere',
  CLOSE_UP: 'minimal movement, slight camera tremor for life, emotional depth in eyes, soft bokeh background shift',
  FLASHBACK: 'slow ken-burns zoom in 3%, sepia color grade, film grain noise, vignette edges, nostalgic soft blur',
};

async function requestVeo2Video(imageBase64, motionPrompt, durationSec = 5) {
  const body = JSON.stringify({
    model: 'veo-2.0-generate-001',
    instances: [{
      image: { bytesBase64Encoded: imageBase64, mimeType: 'image/png' },
      prompt: motionPrompt,
    }],
    parameters: {
      aspectRatio: '16:9',
      durationSeconds: Math.min(durationSec, 8),
      sampleCount: 1,
    }
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)); return; }
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function pollOperation(operationName, maxWaitSec = 300) {
  const startTime = Date.now();
  let attempt = 0;

  while (Date.now() - startTime < maxWaitSec * 1000) {
    attempt++;
    await new Promise(r => setTimeout(r, 10000));

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/${operationName}?key=${API_KEY}`,
        method: 'GET',
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.end();
    });

    if (result.done) {
      if (result.error) throw new Error(JSON.stringify(result.error));
      return result.response;
    }
    console.log(`   ⏳ 폴링 ${attempt}회... (${Math.floor((Date.now() - startTime) / 1000)}초 경과)`);
  }
  throw new Error(`타임아웃: ${maxWaitSec}초 초과`);
}

async function downloadVideo(videoUri, filePath) {
  return new Promise((resolve, reject) => {
    if (videoUri.startsWith('data:')) {
      const b64 = videoUri.split(',')[1];
      fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
      resolve();
      return;
    }
    // API 키 추가 (generativelanguage.googleapis.com 파일 다운로드용)
    const separator = videoUri.includes('?') ? '&' : '?';
    const urlWithKey = videoUri + separator + `key=${API_KEY}`;
    const url = new URL(urlWithKey);
    const options = { hostname: url.hostname, path: url.pathname + url.search, method: 'GET' };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { fs.writeFileSync(filePath, Buffer.concat(chunks)); resolve(); });
    });
    req.on('error', reject);
    req.end();
  });
}

const results = [];
let successCount = 0;
let failCount = 0;

console.log(`🎬 총 ${scenes.length}개 씬 영상 생성 시작 (Veo 2)`);

for (const scene of scenes) {
  const imageResult = imageResults.results.find(r => r.scene_id === scene.scene_id);

  if (!imageResult || imageResult.status !== 'success' || !fs.existsSync(imageResult.file)) {
    console.log(`⏭️ ${scene.scene_id} 이미지 없음, 스킵`);
    results.push({ scene_id: scene.scene_id, status: 'skipped', reason: 'no_image' });
    continue;
  }

  const videoFile = path.join(videosDir, `${scene.scene_id}.mp4`);
  if (fs.existsSync(videoFile)) {
    console.log(`⏭️ ${scene.scene_id} 영상 이미 존재, 스킵`);
    results.push({ scene_id: scene.scene_id, status: 'skipped', file: videoFile });
    continue;
  }

  const motionPrompt = MOTION_TEMPLATES[scene.type] || MOTION_TEMPLATES.CHARACTER_SCENE;
  const imageBase64 = fs.readFileSync(imageResult.file).toString('base64');

  console.log(`🎬 영상 생성: ${scene.scene_id} (${scene.type}, ${scene.duration_sec}초)`);

  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount < maxRetries) {
    try {
      const operation = await requestVeo2Video(imageBase64, motionPrompt, scene.duration_sec);
      console.log(`   📡 Operation: ${operation.name}`);
      const response = await pollOperation(operation.name);

      const videoUri = response.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
                    || response.predictions?.[0]?.video?.uri
                    || response.predictions?.[0]?.bytesBase64Encoded;
      if (!videoUri) throw new Error('영상 URI 없음: ' + JSON.stringify(response).slice(0, 200));

      await downloadVideo(videoUri, videoFile);
      console.log(`   ✅ 저장: videos/${scene.scene_id}.mp4`);
      results.push({ scene_id: scene.scene_id, status: 'success', file: videoFile });
      successCount++;
      break;

    } catch (err) {
      retryCount++;
      const msg = err.message;
      const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('quota');
      const waitSec = isRateLimit ? 60 * retryCount : 15 * retryCount;
      console.warn(`   ⚠️ 시도 ${retryCount}/${maxRetries} 실패: ${msg.slice(0, 100)}`);

      if (retryCount >= maxRetries) {
        console.error(`   ❌ 최종 실패: ${scene.scene_id}`);
        results.push({ scene_id: scene.scene_id, status: 'failed', error: msg });
        failCount++;
      } else {
        console.log(`   ⏳ ${waitSec}초 대기 후 재시도...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
    }
  }

  await new Promise(r => setTimeout(r, 30000));
}

const outPath = path.join(__dirname, '06_video_results.json');
fs.writeFileSync(outPath, JSON.stringify({ results, summary: { success: successCount, failed: failCount } }, null, 2), 'utf-8');

console.log('\n=== 영상 생성 완료 ===');
console.log(`✅ 성공: ${successCount}개 | ❌ 실패: ${failCount}개`);
console.log(`📁 .radio_output/videos/`);
