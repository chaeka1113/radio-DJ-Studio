import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;

const imageFile = fs.readdirSync(path.join(__dirname, 'images'))[0];
const imageBase64 = fs.readFileSync(path.join(__dirname, 'images', imageFile)).toString('base64');

console.log(`테스트 이미지: ${imageFile}`);

const body = JSON.stringify({
  model: 'veo-2.0-generate-001',
  instances: [{ image: { bytesBase64Encoded: imageBase64, mimeType: 'image/png' }, prompt: 'gentle breathing movement, slow zoom' }],
  parameters: { aspectRatio: '16:9', durationSeconds: 5, sampleCount: 1 }
});

// 1) Operation 요청
const op = await new Promise((resolve, reject) => {
  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${API_KEY}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => { console.log('Operation 응답:', data.slice(0, 200)); resolve(JSON.parse(data)); });
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

console.log('Operation name:', op.name);

// 2) 60초 대기 후 폴링
console.log('60초 대기...');
await new Promise(r => setTimeout(r, 60000));

const result = await new Promise((resolve, reject) => {
  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/${op.name}?key=${API_KEY}`,
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

// 전체 응답 구조 출력
console.log('\n=== 전체 응답 ===');
console.log(JSON.stringify(result, null, 2).slice(0, 2000));
