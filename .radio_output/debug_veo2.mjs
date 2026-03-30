import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;

const imageFile = fs.readdirSync(path.join(__dirname, 'images'))[0];
const imageBase64 = fs.readFileSync(path.join(__dirname, 'images', imageFile)).toString('base64');
console.log(`테스트 이미지: ${imageFile}`);

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// 1) Operation 요청
const reqBody = JSON.stringify({
  model: 'veo-2.0-generate-001',
  instances: [{ image: { bytesBase64Encoded: imageBase64, mimeType: 'image/png' }, prompt: 'gentle breathing, slow zoom' }],
  parameters: { aspectRatio: '16:9', durationSeconds: 5, sampleCount: 1 }
});

const opRes = await httpsRequest({
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${API_KEY}`,
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reqBody) },
}, reqBody);

console.log('\n[Operation 응답]', JSON.stringify(opRes.body, null, 2));
if (!opRes.body.name) { console.error('Operation name 없음. 종료.'); process.exit(1); }

// 2) 폴링 (완료될 때까지, 최대 10회)
for (let i = 1; i <= 10; i++) {
  console.log(`\n${i * 15}초 대기...`);
  await new Promise(r => setTimeout(r, 15000));

  const pollRes = await httpsRequest({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/${opRes.body.name}?key=${API_KEY}`,
    method: 'GET',
  }, null);

  console.log(`[폴링 ${i}] done=${pollRes.body.done}, status=${pollRes.status}`);

  if (pollRes.body.done) {
    console.log('\n=== 완료 응답 전체 ===');
    console.log(JSON.stringify(pollRes.body, null, 2).slice(0, 3000));
    break;
  }
}
