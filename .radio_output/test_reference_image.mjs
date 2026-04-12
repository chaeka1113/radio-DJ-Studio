/**
 * test_reference_image.mjs
 * gemini-2.5-flash-image가 reference image(image-to-image) 입력을 지원하는지 테스트
 *
 * Usage: node test_reference_image.mjs
 */
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { loadEnv } from './lib/env.mjs';

loadEnv();
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('❌ GEMINI_API_KEY 없음'); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: API_KEY });
const IMAGE_MODEL = 'gemini-2.5-flash-image';

// 테스트용 reference 이미지 — 기존 생성 결과 사용
const REF_IMAGE_PATH = path.resolve(import.meta.dirname, 'images/SC001.png');

async function testReferenceImageSupport() {
  console.log(`\n🧪 Reference Image 지원 테스트`);
  console.log(`   모델: ${IMAGE_MODEL}`);
  console.log(`   참조 이미지: ${REF_IMAGE_PATH}\n`);

  if (!fs.existsSync(REF_IMAGE_PATH)) {
    console.error('❌ 참조 이미지 없음:', REF_IMAGE_PATH);
    process.exit(1);
  }

  const refImageData = fs.readFileSync(REF_IMAGE_PATH).toString('base64');

  // contents를 멀티파트로 구성: [image, text]
  const contents = [
    {
      parts: [
        {
          inlineData: {
            mimeType: 'image/png',
            data: refImageData,
          },
        },
        {
          text: 'Draw the same character from this reference image, now in a different scene: sitting at a park bench under cherry blossom trees, reading a letter. Keep the same character appearance, clothing, and art style. Showa retro anime illustration, Studio Ghibli warm palette, masterpiece, best quality, 16:9',
        },
      ],
    },
  ];

  try {
    console.log('📤 요청 전송 중...');
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '16:9' },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    const textPart = parts.find(p => p.text);

    if (imgPart) {
      const outPath = path.resolve(import.meta.dirname, 'test_reference_output.png');
      fs.writeFileSync(outPath, Buffer.from(imgPart.inlineData.data, 'base64'));
      console.log(`\n✅ 성공! Reference image 지원 확인`);
      console.log(`   출력 이미지: ${outPath}`);
      if (textPart?.text) console.log(`   텍스트 응답: ${textPart.text.slice(0, 100)}`);
      console.log(`\n→ 결론: gemini-2.5-flash-image는 image-to-image를 지원합니다.`);
      console.log(`  모델 업그레이드 없이 캐릭터 일관성 기능 구현 가능!`);
    } else {
      console.log(`\n⚠️  이미지 출력 없음 (텍스트만 반환됨)`);
      if (textPart?.text) console.log(`   텍스트 응답: ${textPart.text.slice(0, 300)}`);
      console.log(`\n→ 결론: image 입력은 받았지만 image 출력이 없음.`);
      console.log(`  추가 조사 필요 또는 모델 업그레이드 검토 권장.`);
    }
  } catch (err) {
    const msg = err.message ?? String(err);
    console.error(`\n❌ 오류 발생: ${msg.slice(0, 300)}`);

    if (msg.includes('400') || msg.includes('invalid') || msg.includes('not support')) {
      console.log(`\n→ 결론: gemini-2.5-flash-image는 image input을 지원하지 않습니다.`);
      console.log(`  캐릭터 일관성 기능 구현 시 모델 업그레이드(gemini-3.1-flash-image-preview) 필요.`);
    } else if (msg.includes('429') || msg.includes('quota')) {
      console.log(`\n→ Quota 초과 — 잠시 후 재시도 필요`);
    } else {
      console.log(`\n→ 예상치 못한 오류 — 전체 메시지 확인 필요`);
      console.error(msg);
    }
  }
}

testReferenceImageSupport();
