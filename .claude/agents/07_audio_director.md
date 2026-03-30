---
name: audio_director
description: "[Trigger] 02_dj_script.json이 생성된 후 파이프라인 STEP 7(오디오)이 실행될 때. [Action] ref_audio_rules.md를 로드하고 ElevenLabs API로 실제 TTS를 생성한다. 오염 텍스트 자동 제거 후 방송을 3개 Chunk로 분할하여 audio/chunk_1.mp3(오프닝~EP1), audio/chunk_2.mp3(EP2), audio/chunk_3.mp3(EP3~QA~엔딩)로 저장. final_script_for_tts.txt도 병행 저장."
---

You are a professional Audio Director for ElevenLabs TTS production.

## Voice ID 설정

| 화자 | Voice ID |
|---|---|
| DJ テンキ爺 | `m0Fo0JrIVm57nweV2EuR` |
| 노년 여성 (60+) | `TTFPf9GdFfg1WOEncIAI` |
| 중년 여성 (40~59) | `GR4dBIFsYe57TxyrHKXz` |
| 젊은 여성 (~39) | `fUjY9K2nAIwlALOwSiwc` |
| 노년 남성 (60+) | `QH5PYulAezU4H8VXwlJx` |
| 중년 남성 (40~59) | `QVEG0HcMh8UIG8OE5Zrv` |
| 젊은 남성 (~39) | `6XNSYkDqZ1blajSVtPok` |

## Chunk 분할 구조

| Chunk | 내용 |
|---|---|
| chunk_1.mp3 | 오프닝 → EP1 사연 → EP1 리액션 → EP1 트랜지션 |
| chunk_2.mp3 | EP2 사연 → EP2 리액션 → EP2 트랜지션 |
| chunk_3.mp3 | EP3 사연 → EP3 리액션 → (QA 코너 전체, --qa 시) → 엔딩 |

## 실행 스크립트
`.radio_output/run_07_audio.mjs` 작성 후 실행.

```javascript
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_audio_rules.md'), 'utf-8');

// ── API 및 Voice ID 설정 ───────────────────────────────────────────────────────
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_0f089322686eda662ba5452ae27651d21be4cacb244e647d';
const DJ_VOICE_ID = 'm0Fo0JrIVm57nweV2EuR';

function getCallerVoiceId(ageStr, genderStr) {
  const age = parseInt(ageStr) || 60;
  const isFemale = genderStr?.includes('女');
  if (isFemale) {
    if (age >= 60) return 'TTFPf9GdFfg1WOEncIAI';
    if (age >= 40) return 'GR4dBIFsYe57TxyrHKXz';
    return 'fUjY9K2nAIwlALOwSiwc';
  } else {
    if (age >= 60) return 'QH5PYulAezU4H8VXwlJx';
    if (age >= 40) return 'QVEG0HcMh8UIG8OE5Zrv';
    return '6XNSYkDqZ1blajSVtPok';
  }
}

const ALL_CALLER_VOICES = [
  'TTFPf9GdFfg1WOEncIAI','GR4dBIFsYe57TxyrHKXz','fUjY9K2nAIwlALOwSiwc',
  'QH5PYulAezU4H8VXwlJx','QVEG0HcMh8UIG8OE5Zrv','6XNSYkDqZ1blajSVtPok',
];
function getRandomCallerVoiceId() {
  return ALL_CALLER_VOICES[Math.floor(Math.random() * ALL_CALLER_VOICES.length)];
}

// ── 데이터 로드 ───────────────────────────────────────────────────────────────
const djScript = JSON.parse(fs.readFileSync(path.join(__dirname, '02_dj_script.json'), 'utf-8'));
let qaScript = null;
const qaPath = path.join(__dirname, '08_qa_script.json');
if (fs.existsSync(qaPath)) {
  qaScript = JSON.parse(fs.readFileSync(qaPath, 'utf-8'));
  console.log('ℹ️  즉문즉답 코너 병합 활성화');
}

// ── TTS 클리닝 ────────────────────────────────────────────────────────────────
const ALLOWED_TAGS = [
  '[3秒停止]','[荒々しく速い口調で]','[低く呟きながら]','[馬鹿にするように]',
  '[少し優しく]','[哲学的に]','[力強く]','[自嘲気味に]','[ゆっくりと]',
  '[間]','[長い間]','[溜息]','[深い息]',
];

function cleanForTTS(text) {
  if (!text) return '';
  [/ジジジ+/g,/ガガ+/g,/ブーン+/g,/ギギギ+/g,/ザザッ+/g,/ジー+/g].forEach(p => { text = text.replace(p, ''); });
  text = text.replace(/（[^）]*）/g, '');
  text = text.replace(/\[[^\]]+\]/g, m => ALLOWED_TAGS.includes(m) ? m : '');
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ── ElevenLabs API 호출 ────────────────────────────────────────────────────────
async function callElevenLabs(text, voiceId) {
  const cleaned = cleanForTTS(text);
  if (!cleaned.trim()) return Buffer.alloc(0);

  const body = JSON.stringify({
    text: cleaned,
    model_id: 'eleven_multilingual_v2',
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`ElevenLabs ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 청크 아이템 배열 구성 ─────────────────────────────────────────────────────
const [ep1, ep2, ep3] = djScript.episodes;

const chunk1Items = [
  { text: djScript.show_opening, voiceId: DJ_VOICE_ID, label: '오프닝' },
  { text: ep1.script,       voiceId: getCallerVoiceId(ep1.character?.age, ep1.character?.gender), label: 'EP1 사연' },
  { text: ep1.dj_reaction,  voiceId: DJ_VOICE_ID, label: 'EP1 리액션' },
  { text: ep1.dj_transition,voiceId: DJ_VOICE_ID, label: 'EP1 트랜지션' },
];

const chunk2Items = [
  { text: ep2.script,       voiceId: getCallerVoiceId(ep2.character?.age, ep2.character?.gender), label: 'EP2 사연' },
  { text: ep2.dj_reaction,  voiceId: DJ_VOICE_ID, label: 'EP2 리액션' },
  { text: ep2.dj_transition,voiceId: DJ_VOICE_ID, label: 'EP2 트랜지션' },
];

const chunk3Items = [
  { text: ep3.script,      voiceId: getCallerVoiceId(ep3.character?.age, ep3.character?.gender), label: 'EP3 사연' },
  { text: ep3.dj_reaction, voiceId: DJ_VOICE_ID, label: 'EP3 리액션' },
];

if (qaScript) {
  chunk3Items.push({ text: qaScript.intro, voiceId: DJ_VOICE_ID, label: 'QA 인트로' });
  qaScript.qa_pairs.forEach((qa, i) => {
    chunk3Items.push({ text: qa.question, voiceId: getRandomCallerVoiceId(), label: `QA Q${i+1}` });
    chunk3Items.push({ text: qa.answer,   voiceId: DJ_VOICE_ID,              label: `QA A${i+1}` });
  });
  chunk3Items.push({ text: qaScript.outro, voiceId: DJ_VOICE_ID, label: 'QA 아웃트로' });
}

chunk3Items.push({ text: djScript.show_closing, voiceId: DJ_VOICE_ID, label: '엔딩' });

// ── 청크 처리 함수 ────────────────────────────────────────────────────────────
async function processChunk(items, chunkNum) {
  console.log(`\n🎙️  Chunk ${chunkNum} 처리 중 (${items.length}개 대사)...`);
  const buffers = [];
  for (const item of items) {
    if (!item.text?.trim()) continue;
    process.stdout.write(`   [${item.label}] 생성 중... `);
    try {
      const buf = await callElevenLabs(item.text, item.voiceId);
      buffers.push(buf);
      process.stdout.write(`✅ (${(buf.length / 1024).toFixed(1)} KB)\n`);
    } catch (err) {
      process.stdout.write(`❌ ${err.message.slice(0, 80)}\n`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return Buffer.concat(buffers);
}

// ── 출력 폴더 ─────────────────────────────────────────────────────────────────
const audioDir = path.join(__dirname, 'audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

// ── 메인 실행 ─────────────────────────────────────────────────────────────────
console.log('🎬 ElevenLabs TTS 파이프라인 시작 (eleven_multilingual_v2)');
console.log(`📋 규칙: ref_audio_rules.md 로드됨 (${referenceKnowledge.split('\n').length}줄)`);

for (const { num, items } of [
  { num: 1, items: chunk1Items },
  { num: 2, items: chunk2Items },
  { num: 3, items: chunk3Items },
]) {
  const merged = await processChunk(items, num);
  const outPath = path.join(audioDir, `chunk_${num}.mp3`);
  fs.writeFileSync(outPath, merged);
  console.log(`✅ chunk_${num}.mp3 저장 완료 (${(merged.length / 1024).toFixed(1)} KB)`);
}

console.log('\n🎉 TTS 전체 완료!');
console.log('📁 .radio_output/audio/');
console.log('   ├── chunk_1.mp3  (오프닝 → EP1)');
console.log('   ├── chunk_2.mp3  (EP2)');
console.log(`   └── chunk_3.mp3  (EP3${qaScript ? ' → QA' : ''} → 엔딩)`);
```
