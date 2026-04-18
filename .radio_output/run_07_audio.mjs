import fs from 'fs';
import path from 'path';
import https from 'https';
import os from 'os';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs, updateStage } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

const __filename_audio = fileURLToPath(import.meta.url);
const __dirname_audio  = path.dirname(__filename_audio);
const historyPath      = path.join(__dirname_audio, 'ref_broadcast_history.json');

// process.argv에서 --ep 파싱
const epArgIdx = process.argv.indexOf('--ep');
const EP_NUM   = epArgIdx !== -1 ? parseInt(process.argv[epArgIdx + 1]) : null;

// ── 규칙 주입 (핵심 규칙만 주입 — 944줄 전체 스펙 대신 ref_tts_v3_core.md 사용) ────
const referenceKnowledge = fs.existsSync(P.refTtsCore)
  ? fs.readFileSync(P.refTtsCore, 'utf-8')
  : fs.readFileSync(P.refTts, 'utf-8'); // fallback: 전체 스펙

// ── FFmpeg 가용성 체크 & 전역 묵음 파일 생성 ──────────────────────────────────
const SILENCE_SEC = 1.5; // 세그먼트 간 묵음 (초)
let HAS_FFMPEG = false;
try { execSync('ffmpeg -version', { stdio: 'ignore' }); HAS_FFMPEG = true; } catch { /* fallback */ }

// 묵음 파일은 파이프라인 시작 시 한 번만 생성 → 모든 청크가 공유
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
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_API_KEY) {
  console.error('❌ ELEVENLABS_API_KEY 환경변수 없음 — .env 파일 확인');
  process.exit(1);
}
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
const djScript = JSON.parse(fs.readFileSync(P.djScript, 'utf-8'));

let qaScript = null;
const qaPath = P.qaScript;
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
  // 3. 일본어 문자 포함 브래킷 태그 제거 ([間][溜息][荒々しく...] 등)
  text = text.replace(/\[[^\]]*[\u3040-\u9fff][^\]]*\]/g, '');
  // 4. SSML 태그 제거 — V3 미지원
  text = text.replace(/<[^>]+>/g, '');
  // 5. 영문 Audio Tag([sighs],[laughs] 등)는 그대로 통과 — V3 native 지원
  // 6. 공백 정리
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ── DJ Audio Tag 자동 보강 ────────────────────────────────────────────────────
// DJ 텍스트에 Audio Tag가 부족할 때 감정 패턴으로 자동 삽입
function autoInjectDJTags(text) {
  if (!text) return text;
  const existingTags = (text.match(/\[[a-z ]+\]/g) || []).length;
  if (existingTags >= 3) return text; // 이미 충분

  // 패턴별 태그 삽입 (앞뒤 공백 포함)
  const rules = [
    [/まったく(?!\s*\[)/g,          '[scoffs] まったく'],
    [/ふん(?=[、。！　 ]|$)/g,        '[scoffs] ふん'],
    [/フン(?=[、。！　 ]|$)/g,        '[scoffs] フン'],
    [/はぁ(?=[、。　 ]|$)/g,          '[sighs] はぁ'],
    [/ふぅ(?=[、。　 ]|$)/g,          '[sighs] ふぅ'],
    [/やれやれ(?!\s*\[)/g,           '[sighs] やれやれ'],
    [/（笑）/g,                       ' [laughs] '],
    [/（苦笑）/g,                     ' [chuckles] '],
    [/！！(?!\s*\[)/g,               '！！ [excited]'],
    [/\?{2,}(?!\s*\[)/g,            '？？ [curious]'],
    [/ほほう(?!\s*\[)/g,             '[curious] ほほう'],
    [/なんと(?!\s*\[)/g,             '[surprised] なんと'],
    [/ぼそっと/g,                     ' [whispers] '],
  ];

  for (const [pattern, replacement] of rules) {
    text = text.replace(pattern, replacement);
  }
  // 공백 정리
  return text.replace(/[ \t]{2,}/g, ' ').trim();
}

// ── DJ 요청 ID 추적 (previous_request_ids용) ──────────────────────────────────
const djRequestIds = []; // 최근 3개까지 보관 (현재 미사용 — 보이스 호환성 이슈로 비활성화)

// ── ElevenLabs API 단일 호출 ──────────────────────────────────────────────────
function callElevenLabsOnce(cleaned, voiceId, voiceSettings, prevRequestIds = []) {
  const settings = voiceSettings || { stability: 0.5, similarity_boost: 0.75 };
  const payload = {
    text: cleaned,
    model_id: 'eleven_v3',
    voice_settings: settings,
    language_code: 'ja',
  };
  if (prevRequestIds.length > 0) payload.previous_request_ids = prevRequestIds;

  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}/with-timestamps`,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      const requestId = res.headers['request-id'] || null;
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`ElevenLabs ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
          return;
        }
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          const audioBuffer = Buffer.from(json.audio_base64, 'base64');
          resolve({ audioBuffer, alignment: json.alignment || null, requestId });
        } catch (parseErr) {
          reject(new Error(`JSON parse error: ${parseErr.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── ElevenLabs API 호출 (재시도 포함) ─────────────────────────────────────────
// isDJ: true면 previous_request_ids 주입 + 응답 ID 수집
// 반환: { audioBuffer: Buffer, alignment: object|null }
async function callElevenLabs(text, voiceId, voiceSettings, isDJ = false) {
  let processedText = cleanForTTS(text);
  if (isDJ) processedText = autoInjectDJTags(processedText);
  if (!processedText.trim()) return { audioBuffer: Buffer.alloc(0), alignment: null };

  const prevIds = []; // previous_request_ids 비활성화 — eleven_v3 보이스 호환성 문제
  const MAX_RETRY = 2;
  const RETRY_DELAY = [3000, 6000];

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const result = await callElevenLabsOnce(processedText, voiceId, voiceSettings, prevIds);
      // DJ 요청 ID 수집 (최근 3개 유지)
      // request-id 수집 비활성화 (보이스 호환성 이슈)
      return result;
    } catch (err) {
      if (attempt < MAX_RETRY) {
        const wait = RETRY_DELAY[attempt];
        process.stdout.write(`\n   ⏳ 재시도 ${attempt + 1}/${MAX_RETRY} (${wait / 1000}초 후)... `);
        await new Promise(r => setTimeout(r, wait));
      } else {
        // 최종 실패 — 태그 제거 후 한 번 더
        const reClean = processedText.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
        if (reClean !== processedText && reClean.length > 0) {
          process.stdout.write(`\n   🔄 클리닝 강화 후 최종 시도... `);
          try {
            return await callElevenLabsOnce(reClean, voiceId, voiceSettings, prevIds);
          } catch (finalErr) {
            throw finalErr;
          }
        }
        throw err;
      }
    }
  }
}

// ── 청크 배열 구성 ─────────────────────────────────────────────────────────────
const djEpisodes = djScript.episodes ?? [];
if (djEpisodes.length < 3) {
  console.error(`❌ 02_dj_script.json에 에피소드 ${djEpisodes.length}개뿐 — 최소 3개 필요`);
  process.exit(1);
}
const [ep1, ep2, ep3] = djEpisodes;

// V3 최적화 음성 설정
const DJ_VOICE_SETTINGS     = { stability: 0.38, similarity_boost: 0.80, style: 0.65, use_speaker_boost: true };
const CALLER_VOICE_SETTINGS = { stability: 0.50, similarity_boost: 0.75, style: 0.30, use_speaker_boost: false };

// ── 07 QA+클로징 아이템 동적 구성 ────────────────────────────────────────────
const qaAndClosingItems = [];
if (qaScript) {
  qaAndClosingItems.push({ text: qaScript.intro, voiceId: DJ_VOICE_ID, label: 'QA 인트로', isDJ: true });
  qaScript.qa_pairs.forEach((qa, i) => {
    qaAndClosingItems.push({ text: qa.question, voiceId: getRandomCallerVoiceId(), label: `QA Q${i + 1}`, isDJ: false });
    qaAndClosingItems.push({ text: qa.answer,   voiceId: DJ_VOICE_ID,              label: `QA A${i + 1}`, isDJ: true  });
  });
  // ⚠️ qaScript.outro == djScript.show_closing 이므로 outro는 생략 — show_closing 한 번만 추가
}
qaAndClosingItems.push({ text: djScript.show_closing, voiceId: DJ_VOICE_ID, label: '엔딩', isDJ: true });

// ── 동적 audioChunks 배열 (순서 = 영상 씬 순서와 1:1 대응) ───────────────────
const audioChunks = [
  {
    id: '00_opening',
    label: '오프닝',
    items: [
      { text: djScript.show_opening, voiceId: DJ_VOICE_ID, label: '오프닝', isDJ: true },
    ],
  },
  {
    id: '01_ep1_story',
    label: 'EP1 사연',
    items: [
      { text: ep1.script, voiceId: getCallerVoiceId(ep1.character?.age, ep1.character?.gender), label: 'EP1 사연', isDJ: false },
    ],
  },
  {
    id: '02_ep1_dj',
    label: 'EP1 DJ 멘트',
    // .filter: dj_transition 없는 에피소드에서 빈 아이템이 TTS 호출로 넘어가는 것 방지
    items: [
      { text: ep1.dj_reaction,   voiceId: DJ_VOICE_ID, label: 'EP1 리액션',   isDJ: true },
      { text: ep1.dj_transition, voiceId: DJ_VOICE_ID, label: 'EP1 트랜지션', isDJ: true },
    ].filter(item => item.text?.trim()),
  },
  {
    id: '03_ep2_story',
    label: 'EP2 사연',
    items: [
      { text: ep2.script, voiceId: getCallerVoiceId(ep2.character?.age, ep2.character?.gender), label: 'EP2 사연', isDJ: false },
    ],
  },
  {
    id: '04_ep2_dj',
    label: 'EP2 DJ 멘트',
    items: [
      { text: ep2.dj_reaction,   voiceId: DJ_VOICE_ID, label: 'EP2 리액션',   isDJ: true },
      { text: ep2.dj_transition, voiceId: DJ_VOICE_ID, label: 'EP2 트랜지션', isDJ: true },
    ].filter(item => item.text?.trim()),
  },
  {
    id: '05_ep3_story',
    label: 'EP3 사연',
    items: [
      { text: ep3.script, voiceId: getCallerVoiceId(ep3.character?.age, ep3.character?.gender), label: 'EP3 사연', isDJ: false },
    ],
  },
  {
    id: '06_ep3_dj',
    label: 'EP3 DJ 멘트',
    // ep3.dj_transition: QA 코너 진입 전 브리지가 있을 경우 포함
    items: [
      { text: ep3.dj_reaction,   voiceId: DJ_VOICE_ID, label: 'EP3 리액션',   isDJ: true },
      { text: ep3.dj_transition, voiceId: DJ_VOICE_ID, label: 'EP3 트랜지션', isDJ: true },
    ].filter(item => item.text?.trim()),
  },
  {
    id: '07_qa_and_closing',
    label: qaScript ? 'QA + 엔딩' : '엔딩',
    items: qaAndClosingItems,
  },
];

// ── 청크 처리 함수 (FFmpeg 묵음 삽입 포함) ───────────────────────────────────
// 반환: { merged: Buffer, alignments: Array<{label, alignment}> }
async function processChunk(chunk) {
  const { id, label, items } = chunk;
  console.log(`\n🎙️  [${id}] ${label} 처리 중 (${items.length}개 대사)...`);

  const tmpDir = path.join(os.tmpdir(), `radio_${id}_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const segFiles = [];
  const alignments = [];

  for (const item of items) {
    if (!item.text?.trim()) continue;
    process.stdout.write(`   [${item.label}] 생성 중... `);
    const voiceSettings = item.isDJ ? DJ_VOICE_SETTINGS : CALLER_VOICE_SETTINGS;
    try {
      const { audioBuffer, alignment } = await callElevenLabs(item.text, item.voiceId, voiceSettings, item.isDJ);
      if (audioBuffer.length === 0) { process.stdout.write(`⏭ (빈 버퍼 스킵)\n`); continue; }
      const segFile = path.join(tmpDir, `seg_${segFiles.length}_${item.label.replace(/\s+/g, '_')}.mp3`);
      fs.writeFileSync(segFile, audioBuffer);
      segFiles.push(segFile);
      if (alignment) alignments.push({ label: item.label, voiceId: item.voiceId, alignment });
      process.stdout.write(`✅ (${(audioBuffer.length / 1024).toFixed(1)} KB)\n`);
    } catch (err) {
      process.stdout.write(`❌ ${err.message.slice(0, 80)}\n`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (segFiles.length === 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { merged: Buffer.alloc(0), alignments: [] };
  }

  let result;
  if (HAS_FFMPEG && segFiles.length > 1 && fs.existsSync(SILENCE_FILE)) {
    // 전역 silence_1.5s.mp3를 재사용해 세그먼트 사이 묵음 삽입
    try {
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
  return { merged: result, alignments };
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

fs.writeFileSync(P.finalTtsScript, ttsText, 'utf-8');
console.log('📄 final_script_for_tts.txt 저장 완료');

// ── 출력 폴더 ─────────────────────────────────────────────────────────────────
const audioDir = P.audio;


// ── 메인 실행 ─────────────────────────────────────────────────────────────────
console.log('🎬 ElevenLabs TTS 파이프라인 시작 (eleven_v3)');
console.log(`📋 규칙: ref_tts_v3_rules.md 로드됨 (${referenceKnowledge.split('\n').length}줄)`);
console.log(`🎛️  DJ 설정: stability=${DJ_VOICE_SETTINGS.stability} / style=${DJ_VOICE_SETTINGS.style}`);
console.log(`📦 총 ${audioChunks.length}개 오디오 모듈 생성 예정`);

// 영상 파이프라인 연동용 매니페스트
const manifest = { generated_at: new Date().toISOString(), chunks: [] };

for (const chunk of audioChunks) {
  const outPath       = path.join(audioDir, `${chunk.id}.mp3`);
  const tsPath        = path.join(audioDir, `${chunk.id}_timestamps.json`);

  // [CRITICAL 멱등성] MP3 + _timestamps.json 둘 다 존재할 때만 스킵
  if (fs.existsSync(outPath) && fs.existsSync(tsPath)) {
    const sizeKB = parseFloat((fs.statSync(outPath).size / 1024).toFixed(1));
    console.log(`⏭  ${chunk.id}.mp3 스킵 (MP3 + timestamps.json 이미 존재, ${sizeKB} KB)`);
    manifest.chunks.push({
      id: chunk.id,
      label: chunk.label,
      file: `audio/${chunk.id}.mp3`,
      timestamps_file: `audio/${chunk.id}_timestamps.json`,
      size_kb: sizeKB,
      item_count: chunk.items.length,
      skipped: true,
    });
    continue;
  }

  const { merged, alignments } = await processChunk(chunk);
  if (merged.length === 0) {
    console.log(`⏭  ${chunk.id}.mp3 스킵 (빈 결과)`);
    continue;
  }

  fs.writeFileSync(outPath, merged);
  const sizeKB = parseFloat((merged.length / 1024).toFixed(1));
  console.log(`✅ ${chunk.id}.mp3 저장 완료 (${sizeKB} KB)`);

  // alignment 저장 — 세그먼트 배열로 묶어서 저장
  const tsData = {
    chunk_id: chunk.id,
    label: chunk.label,
    generated_at: new Date().toISOString(),
    segments: alignments,
  };
  fs.writeFileSync(tsPath, JSON.stringify(tsData, null, 2), 'utf-8');
  console.log(`📍 ${chunk.id}_timestamps.json 저장 완료 (${alignments.length}개 세그먼트)`);

  manifest.chunks.push({
    id: chunk.id,
    label: chunk.label,
    file: `audio/${chunk.id}.mp3`,
    timestamps_file: `audio/${chunk.id}_timestamps.json`,
    size_kb: sizeKB,
    item_count: chunk.items.length,
  });
}

// 매니페스트 저장 (영상 파이프라인에서 청크 목록/메타데이터 참조용)
fs.writeFileSync(P.audioManifest, JSON.stringify(manifest, null, 2), 'utf-8'); updateStage(P, 'audio_done');
console.log('📋 09_audio_manifest.json 저장 완료 (영상 파이프라인 연동용)');

// ── 가비지 컬렉션: 전역 임시 파일 삭제 ──────────────────────────────────────
try {
  fs.rmSync(GLOBAL_TMP_DIR, { recursive: true, force: true });
  console.log('🗑  임시 파일 정리 완료 (silence_1.5s.mp3)');
} catch { /* 정리 실패는 무시 */ }

const ep3HasTransition = !!ep3.dj_transition?.trim();
console.log('\n🎉 TTS 전체 완료!');
console.log('📁 .radio_output/audio/');
console.log('   ├── 00_opening.mp3          (오프닝)');
console.log('   ├── 01_ep1_story.mp3        (EP1 사연)');
console.log('   ├── 02_ep1_dj.mp3           (EP1 리액션 + 트랜지션)');
console.log('   ├── 03_ep2_story.mp3        (EP2 사연)');
console.log('   ├── 04_ep2_dj.mp3           (EP2 리액션 + 트랜지션)');
console.log('   ├── 05_ep3_story.mp3        (EP3 사연)');
console.log(`   ├── 06_ep3_dj.mp3           (EP3 리액션${ep3HasTransition ? ' + 트랜지션' : ''})`);
console.log(`   └── 07_qa_and_closing.mp3   (${qaScript ? 'QA + ' : ''}엔딩)`);
console.log('📋 .radio_output/09_audio_manifest.json (영상 파이프라인 연동)');

// ── EP별 사연 오디오 재생 시간 측정 → ep_durations.json ──────────────────────
if (HAS_FFMPEG) {
  console.log('\n📊 EP별 사연 오디오 길이 측정 중...');
  const epAudioFiles = [
    { key: 'ep1', file: 'audio/01_ep1_story.mp3' },
    { key: 'ep2', file: 'audio/03_ep2_story.mp3' },
    { key: 'ep3', file: 'audio/05_ep3_story.mp3' },
  ];
  const durations = {};
  for (const { key, file } of epAudioFiles) {
    const filePath = path.join(P.audio, path.basename(file));
    if (fs.existsSync(filePath)) {
      try {
        const dur = parseFloat(execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
        ).toString().trim());
        durations[`${key}_script_sec`] = dur;
        durations[`${key}_audio_path`] = file;
        console.log(`   ✅ ${key}: ${dur.toFixed(1)}초 (${file})`);
      } catch (err) {
        console.warn(`   ⚠️ ${key} 측정 실패: ${err.message.slice(0, 60)}`);
      }
    } else {
      console.warn(`   ⚠️ ${key} 파일 없음: ${file}`);
    }
  }
  fs.writeFileSync(
    path.join(P.audio, 'ep_durations.json'),
    JSON.stringify(durations, null, 2),
    'utf-8'
  );
  console.log('📊 audio/ep_durations.json 저장 완료 (영상 파이프라인 연동용)');
} else {
  console.log('⚠️ FFmpeg 없음 — ep_durations.json 생성 스킵');
}

// ── 방송 히스토리 업데이트 ────────────────────────────────────────────────────
async function updateBroadcastHistory(epNum) {
  if (!epNum || isNaN(epNum) || epNum < 1) {
    console.log('🧪 테스트 모드 — 히스토리 저장 스킵');
    return;
  }

  // 히스토리 파일 없으면 초기화
  const defaultHistory = {
    meta: { total_episodes: 0, last_updated: '' },
    dj_character: { established_traits: [], running_gags: [] },
    listeners: [],
    episodes: [],
  };

  let history;
  if (!fs.existsSync(historyPath)) {
    history = defaultHistory;
  } else {
    history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
  }

  // 이미 같은 EP 번호가 히스토리에 있으면 덮어쓰지 않고 경고
  const alreadyExists = history.episodes.find(e => e.ep_num === epNum);
  if (alreadyExists) {
    console.log(`⚠️ EP${epNum} 히스토리가 이미 존재합니다. 저장 스킵.`);
    return;
  }

  console.log(`📼 EP${epNum} 히스토리 저장 시작...`);

  // 대본 데이터에서 청취자 정보 추출
  const scripts = fs.existsSync(P.scripts) ? JSON.parse(fs.readFileSync(P.scripts, 'utf-8')) : null;
  const today = new Date().toISOString().slice(0, 10);
  const allKeywords = (scripts?.episodes || []).map(ep => ep.theme).filter(Boolean);

  // 에피소드 요약
  const epEntry = {
    ep_num: epNum,
    date: today,
    keywords: allKeywords,
    dj_highlights: djScript.episodes.map(ep =>
      (ep.dj_reaction || '').split(/[。！？]/)[0]?.trim() || ''
    ).filter(Boolean).join(' / '),
    memorable_line: (() => {
      const reaction = djScript.episodes[0]?.dj_reaction || '';
      const sentences = reaction.split(/[。！？]/).map(s => s.trim()).filter(Boolean);
      return sentences[Math.min(1, sentences.length - 1)] || '...';
    })(),
  };

  // 청취자 정보 추가 / 재등장 시 last_appeared 갱신
  const newListeners = (scripts?.episodes || []).map(ep => ({
    name: ep.character?.name || '不明',
    age: parseInt(ep.character?.age) || 60,
    keywords: [ep.theme].filter(Boolean),
    first_appeared: epNum,
    last_appeared: epNum,
    profile: ep.character?.personality_desc || '',
    outcome: ep.character?.flaw_trigger || ep.character?.personality_desc || '',
  }));

  for (const newL of newListeners) {
    const existing = history.listeners.find(l => l.name === newL.name);
    if (existing) {
      existing.last_appeared = epNum;
    } else {
      history.listeners.push(newL);
    }
  }

  history.episodes.push(epEntry);
  history.meta.total_episodes = history.episodes.length;
  history.meta.last_updated = today;

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
  console.log(`✅ EP${epNum} 히스토리 저장 완료 → ref_broadcast_history.json`);
  console.log(`   총 누적 회차: ${history.meta.total_episodes}회`);
}

await updateBroadcastHistory(EP_NUM);
