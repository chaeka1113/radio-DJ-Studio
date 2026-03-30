import fs from 'fs';
import path from 'path';
import https from 'https';
import os from 'os';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 규칙 주입 (V3 가이드라인 우선 로드) ─────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_tts_v3_rules.md'), 'utf-8');

// ── FFmpeg 가용성 체크 & 전역 묵음 파일 생성 ──────────────────────────────────
const SILENCE_SEC = 1.5; // 세그먼트 간 묵음 (초)
let HAS_FFMPEG = false;
try { execSync('ffmpeg -version', { stdio: 'ignore' }); HAS_FFMPEG = true; } catch { /* fallback */ }

// 묵음 파일은 파이프라인 시작 시 한 번만 생성 → 모든 청크가 공유 (재발 방지)
const GLOBAL_TMP_DIR = path.join(os.tmpdir(), `radio_global_${Date.now()}`);
fs.mkdirSync(GLOBAL_TMP_DIR, { recursive: true });
const SILENCE_FILE = path.join(GLOBAL_TMP_DIR, 'silence_1.5s.mp3');

if (HAS_FFMPEG) {
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(SILENCE_SEC),
    '-q:a', '9',
    '-acodec', 'libmp3lame',
    SILENCE_FILE,
  ], { stdio: 'ignore' });
  console.log(`🔇 FFmpeg: ✅ silence_1.5s.mp3 생성 완료 (${SILENCE_SEC}초 묵음 삽입 활성)`);
} else {
  console.log('🔇 FFmpeg: ⚠️ 없음 — 묵음 없이 직접 concat (폴백 모드)');
}

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
  'TTFPf9GdFfg1WOEncIAI', 'GR4dBIFsYe57TxyrHKXz', 'fUjY9K2nAIwlALOwSiwc',
  'QH5PYulAezU4H8VXwlJx', 'QVEG0HcMh8UIG8OE5Zrv', '6XNSYkDqZ1blajSVtPok',
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

// ── TTS 클리닝 (ElevenLabs V3 — NO SSML, 영문 Audio Tag 통과) ────────────────
function cleanForTTS(text) {
  if (!text) return '';
  // 1. 노이즈 의성어 제거
  [/ジジジ+/g, /ガガ+/g, /ブーン+/g, /ギギギ+/g, /ザザッ+/g, /ジー+/g].forEach(p => { text = text.replace(p, ''); });
  // 2. 일본어 괄호 행동묘사 제거 （）
  text = text.replace(/（[^）]*）/g, '');
  // 3. 일본어 문자 포함 브래킷 태그 제거 ([間][溜息][荒々しく...] 등 구 Japanese 지문)
  //    — 히라가나/카타카나/한자(\u3040-\u9fff)를 포함한 [] 태그 전부 삭제
  text = text.replace(/\[[^\]]*[\u3040-\u9fff][^\]]*\]/g, '');
  // 4. SSML 태그 제거 (<break time="..."/>, <speak> 등) — V3 미지원
  text = text.replace(/<[^>]+>/g, '');
  // 5. 영문 Audio Tag([sighs],[laughs] 등)는 그대로 통과 — V3 native 지원
  // 6. 공백 정리
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ── ElevenLabs API 단일 호출 ──────────────────────────────────────────────────
function callElevenLabsOnce(cleaned, voiceId, voiceSettings) {
  const settings = voiceSettings || { stability: 0.5, similarity_boost: 0.75 };
  const body = JSON.stringify({
    text: cleaned,
    model_id: 'eleven_v3',
    voice_settings: settings,
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

// ── ElevenLabs API 호출 (재시도 포함) ─────────────────────────────────────────
async function callElevenLabs(text, voiceId, voiceSettings) {
  const cleaned = cleanForTTS(text);
  if (!cleaned.trim()) return Buffer.alloc(0);

  const MAX_RETRY = 2;
  const RETRY_DELAY = [3000, 6000];

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      return await callElevenLabsOnce(cleaned, voiceId, voiceSettings);
    } catch (err) {
      if (attempt < MAX_RETRY) {
        const wait = RETRY_DELAY[attempt];
        process.stdout.write(`\n   ⏳ 재시도 ${attempt + 1}/${MAX_RETRY} (${wait / 1000}초 후)... `);
        await new Promise(r => setTimeout(r, wait));
      } else {
        // 최종 실패 — ref_audio_rules 클리닝 재적용 후 한 번 더
        const reClean = cleaned.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
        if (reClean !== cleaned && reClean.length > 0) {
          process.stdout.write(`\n   🔄 클리닝 강화 후 최종 시도... `);
          try {
            return await callElevenLabsOnce(reClean, voiceId, voiceSettings);
          } catch (finalErr) {
            throw finalErr;
          }
        }
        throw err;
      }
    }
  }
}

// ── 청크 아이템 배열 구성 ─────────────────────────────────────────────────────
const [ep1, ep2, ep3] = djScript.episodes;

// V3 최적화 음성 설정
// stability 낮출수록 감정 다이나믹 증가, style(style_exaggeration) 0.6+ = Audio Tag 확실 반영
const DJ_VOICE_SETTINGS    = { stability: 0.38, similarity_boost: 0.80, style: 0.65, use_speaker_boost: true };
const CALLER_VOICE_SETTINGS = { stability: 0.50, similarity_boost: 0.75, style: 0.30, use_speaker_boost: false };

const chunk1Items = [
  { text: djScript.show_opening,  voiceId: DJ_VOICE_ID,                                                        label: '오프닝',       isDJ: true  },
  { text: ep1.script,             voiceId: getCallerVoiceId(ep1.character?.age, ep1.character?.gender),        label: 'EP1 사연',     isDJ: false },
  { text: ep1.dj_reaction,        voiceId: DJ_VOICE_ID,                                                        label: 'EP1 리액션',   isDJ: true  },
  { text: ep1.dj_transition,      voiceId: DJ_VOICE_ID,                                                        label: 'EP1 트랜지션', isDJ: true  },
];

const chunk2Items = [
  { text: ep2.script,             voiceId: getCallerVoiceId(ep2.character?.age, ep2.character?.gender),        label: 'EP2 사연',     isDJ: false },
  { text: ep2.dj_reaction,        voiceId: DJ_VOICE_ID,                                                        label: 'EP2 리액션',   isDJ: true  },
  { text: ep2.dj_transition,      voiceId: DJ_VOICE_ID,                                                        label: 'EP2 트랜지션', isDJ: true  },
];

const chunk3Items = [
  { text: ep3.script,             voiceId: getCallerVoiceId(ep3.character?.age, ep3.character?.gender),        label: 'EP3 사연',     isDJ: false },
  { text: ep3.dj_reaction,        voiceId: DJ_VOICE_ID,                                                        label: 'EP3 리액션',   isDJ: true  },
];

if (qaScript) {
  chunk3Items.push({ text: qaScript.intro, voiceId: DJ_VOICE_ID, label: 'QA 인트로', isDJ: true });
  qaScript.qa_pairs.forEach((qa, i) => {
    chunk3Items.push({ text: qa.question, voiceId: getRandomCallerVoiceId(), label: `QA Q${i + 1}`, isDJ: false });
    chunk3Items.push({ text: qa.answer,   voiceId: DJ_VOICE_ID,              label: `QA A${i + 1}`, isDJ: true  });
  });
  // ⚠️ qaScript.outro는 run_02_dj.mjs에서 djScript.show_closing을 그대로 복사한 값이므로
  //    여기에 push하면 아래 show_closing과 완전 동일한 텍스트가 2번 TTS 전송된다 → 반드시 생략
}

// 방송 전체의 마지막에 단 한 번만 엔딩 삽입 (QA 유무 무관)
chunk3Items.push({ text: djScript.show_closing, voiceId: DJ_VOICE_ID, label: '엔딩', isDJ: true });

// ── 청크 처리 함수 (FFmpeg 묵음 삽입 포함) ───────────────────────────────────
async function processChunk(items, chunkNum) {
  console.log(`\n🎙️  Chunk ${chunkNum} 처리 중 (${items.length}개 대사)...`);

  const tmpDir = path.join(os.tmpdir(), `radio_c${chunkNum}_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const segFiles = [];

  for (const item of items) {
    if (!item.text?.trim()) continue;
    process.stdout.write(`   [${item.label}] 생성 중... `);
    const voiceSettings = item.isDJ ? DJ_VOICE_SETTINGS : CALLER_VOICE_SETTINGS;
    try {
      const buf = await callElevenLabs(item.text, item.voiceId, voiceSettings);
      if (buf.length === 0) { process.stdout.write(`⏭ (빈 버퍼 스킵)\n`); continue; }
      const segFile = path.join(tmpDir, `seg_${segFiles.length}_${item.label.replace(/\s+/g, '_')}.mp3`);
      fs.writeFileSync(segFile, buf);
      segFiles.push(segFile);
      process.stdout.write(`✅ (${(buf.length / 1024).toFixed(1)} KB)\n`);
    } catch (err) {
      process.stdout.write(`❌ ${err.message.slice(0, 80)}\n`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (segFiles.length === 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return Buffer.alloc(0);
  }

  let result;
  if (HAS_FFMPEG && segFiles.length > 1 && fs.existsSync(SILENCE_FILE)) {
    // ── 전역 silence_1.5s.mp3를 재사용해 세그먼트 사이 묵음 삽입 ──────────────
    try {
      // concat 리스트: seg0 → silence → seg1 → silence → seg2 ...
      // Windows 경로 호환: 슬래시를 이중 역슬래시 대신 정방향 슬래시로 정규화
      const normalize = (p) => p.replace(/\\/g, '/');
      const concatListFile = path.join(tmpDir, 'list.txt');
      const entries = segFiles.flatMap((f, i) =>
        i === 0
          ? [`file '${normalize(f)}'`]
          : [`file '${normalize(SILENCE_FILE)}'`, `file '${normalize(f)}'`]
      );
      fs.writeFileSync(concatListFile, entries.join('\n'), 'utf-8');

      const outFile = path.join(tmpDir, 'merged.mp3');
      execFileSync('ffmpeg', [
        '-y', '-f', 'concat', '-safe', '0',
        '-i', concatListFile, '-c', 'copy', outFile,
      ], { stdio: 'ignore' });

      result = fs.readFileSync(outFile);
      console.log(`   🔇 silence_1.5s.mp3 × ${segFiles.length - 1}개 삽입 완료`);
    } catch (ffErr) {
      console.warn(`   ⚠️ FFmpeg concat 실패 (${ffErr.message.slice(0, 60)}) → 직접 concat 폴백`);
      result = Buffer.concat(segFiles.map(f => fs.readFileSync(f)));
    }
  } else {
    result = Buffer.concat(segFiles.map(f => fs.readFileSync(f)));
    if (segFiles.length > 1) console.log('   ⚠️ FFmpeg/silence 없음 — 직접 concat');
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return result;
}

// ── final_script_for_tts.txt 생성 ────────────────────────────────────────────
const SEP = '━'.repeat(56);
const V3_TAGS_LINE = '[sighs] [laughs] [chuckles] [angry] [whispers] [surprised]\n          [sad] [excited] [nervous] [scoffs] [clears throat]\n          포즈: ... (줄임표) | NO SSML | NO 일본어 지문';

let ttsText = `================================================================\nテンキ爺ラジオ — TTS 합본 (ElevenLabs V3 복사 붙여넣기용)\nV3 허용 Audio Tag: ${V3_TAGS_LINE}\n================================================================\n\n【テンキ爺 — 방송 오프닝】\n${cleanForTTS(djScript.show_opening)}\n`;

for (const ep of djScript.episodes) {
  const char = ep.character || {};
  ttsText += `\n${SEP}\nEP${ep.id} ／ ${ep.theme} ／ ${ep.title}\n${SEP}\n\n【ナレーター（${char.name || '?'}・${char.age || '?'}）】\n${cleanForTTS(ep.script)}\n\n【テンキ爺 — EP${ep.id} 리액션】\n${cleanForTTS(ep.dj_reaction)}\n`;
  if (ep.dj_transition) ttsText += `\n【テンキ爺 — EP${ep.id} 트랜지션】\n${cleanForTTS(ep.dj_transition)}\n`;
}

if (qaScript) {
  ttsText += `\n${SEP}\nQA コーナー\n${SEP}\n\n【テンキ爺 — QA 인트로】\n${cleanForTTS(qaScript.intro)}\n`;
  qaScript.qa_pairs.forEach((qa, i) => {
    ttsText += `\n【Q${i + 1}】\n${cleanForTTS(qa.question)}\n\n【テンキ爺 — A${i + 1}】\n${cleanForTTS(qa.answer)}\n`;
  });
  ttsText += `\n【テンキ爺 — QA 아웃트로】\n${cleanForTTS(qaScript.outro)}\n`;
}

ttsText += `\n${SEP}\n방송 엔딩\n${SEP}\n\n【テンキ爺 — 엔딩】\n${cleanForTTS(djScript.show_closing)}\n`;

fs.writeFileSync(path.join(__dirname, 'final_script_for_tts.txt'), ttsText, 'utf-8');
console.log('📄 final_script_for_tts.txt 저장 완료');

// ── 출력 폴더 ─────────────────────────────────────────────────────────────────
const audioDir = path.join(__dirname, 'audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

// ── 메인 실행 ─────────────────────────────────────────────────────────────────
console.log('🎬 ElevenLabs TTS 파이프라인 시작 (eleven_v3)');
console.log(`📋 규칙: ref_tts_v3_rules.md 로드됨 (${referenceKnowledge.split('\n').length}줄)`);
console.log(`🎛️  DJ 설정: stability=${DJ_VOICE_SETTINGS.stability} / style=${DJ_VOICE_SETTINGS.style}`);

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

// ── 가비지 컬렉션: 전역 임시 파일(silence_1.5s.mp3 등) 삭제 ─────────────────
try {
  fs.rmSync(GLOBAL_TMP_DIR, { recursive: true, force: true });
  console.log('🗑  임시 파일 정리 완료 (silence_1.5s.mp3)');
} catch { /* 정리 실패는 무시 */ }

console.log('\n🎉 TTS 전체 완료!');
console.log('📁 .radio_output/audio/');
console.log('   ├── chunk_1.mp3  (오프닝 → EP1)');
console.log('   ├── chunk_2.mp3  (EP2)');
console.log(`   └── chunk_3.mp3  (EP3${qaScript ? ' → QA' : ''} → 엔딩)`);
