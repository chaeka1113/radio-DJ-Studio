/**
 * gen_thumb_bases.mjs
 * テンキ爺 고정 썸네일 베이스 이미지 3장 생성
 * → assets/thumb_base_1.png, thumb_base_2.png, thumb_base_3.png
 */
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { loadEnv } from './.radio_output/lib/env.mjs';

loadEnv();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const OUT = path.join(process.cwd(), 'assets');
fs.mkdirSync(OUT, { recursive: true });

// DJ 씬 레퍼런스 기반 스타일 고정 prefix
const STYLE = `(Showa retro anime, Studio Ghibli style hand-drawn illustration), \
A battered retro tin robot DJ (Tenki-jii), square boxy head with cracked paint and rust spots, \
single glowing mono-eye, bent antennae, faded red chest panel with analog dials, worn mechanical arms, \
warm amber vacuum tube glow, Showa retro anime illustration, Studio Ghibli warm palette, \
masterpiece, best quality, highly detailed, 8k, cinematic, 16:9`;

const PROMPTS = [
  {
    name: 'thumb_base_1',
    desc: '정면 삿대질 — 분노/독설 구도',
    prompt: `${STYLE}, \
Tenki-jii facing slightly left, pointing aggressively at viewer with one mechanical arm, \
leaning forward over vintage radio desk, dramatic low-angle shot, \
LEFT SIDE CHARACTER occupying 40% of frame, RIGHT SIDE intentionally empty dark background for text overlay, \
dusty amber studio light, vinyl records stacked in background, moody cinematic lighting`,
  },
  {
    name: 'thumb_base_2',
    desc: '측면 마이크 — 방송 클래식 구도',
    prompt: `${STYLE}, \
Tenki-jii in profile view facing left, speaking into a large vintage microphone, \
one mechanical arm raised dramatically, glowing mono-eye intense expression, \
CHARACTER ON LEFT THIRD of frame, large empty dark right side for text, \
warm amber and deep navy background with bokeh studio equipment, dramatic side lighting`,
  },
  {
    name: 'thumb_base_3',
    desc: '클로즈업 얼굴 — 충격/반응 구도',
    prompt: `${STYLE}, \
Extreme close-up of Tenki-jii robot face, cracked mono-eye wide open in shock/anger expression, \
rust and paint chips detail, bent antennae crackling with electricity, \
FACE ON LEFT HALF of frame tilted slightly, RIGHT HALF dark gradient background for title text overlay, \
dramatic rim lighting, cinematic depth of field`,
  },
];

async function generate(item) {
  console.log(`\n🎨 [${item.name}] ${item.desc} 생성 중...`);
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ text: item.prompt }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '16:9' },
        },
      });
      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
      if (!imgPart) throw new Error('이미지 데이터 없음');

      const buf = Buffer.from(imgPart.inlineData.data, 'base64');
      const outPath = path.join(OUT, `${item.name}.png`);
      fs.writeFileSync(outPath, buf);
      console.log(`✅ 저장 완료 → assets/${item.name}.png (${(buf.length/1024).toFixed(0)} KB)`);
      return;
    } catch (e) {
      lastErr = e;
      const wait = attempt * 30;
      console.warn(`   ⚠️  시도 ${attempt} 실패: ${e.message.slice(0,80)} — ${wait}초 대기`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }
  console.error(`❌ ${item.name} 실패: ${lastErr?.message}`);
}

for (const item of PROMPTS) {
  await generate(item);
  if (PROMPTS.indexOf(item) < PROMPTS.length - 1) {
    console.log('   ⏳ 30초 대기 (rate limit 방어)...');
    await new Promise(r => setTimeout(r, 30000));
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ 썸네일 베이스 3장 생성 완료\nassets/ 폴더에서 확인 후\n마음에 드는 걸 assets/master_base.png 로 복사해서 사용하세요.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
