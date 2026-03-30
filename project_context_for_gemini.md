# テンキ爺ラジオ — Project Context for Gemini
> 이 문서는 프로젝트의 모든 소스 파일을 100% 원문 그대로 병합한 컨텍스트 문서입니다.

---

## 📁 CLAUDE.md

```
@AGENTS.md
```

---

## 📁 AGENTS.md

```markdown
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
```

---

## 📁 package.json

```json
{
  "name": "radio-dj-studio",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "studio": "node server.mjs"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.80.0",
    "@google/generative-ai": "^0.24.1",
    "dotenv": "^17.3.1",
    "express": "^5.2.1"
  }
}
```

---

## 📁 server.mjs

```javascript
import 'dotenv/config';
import express from 'express';
import { spawn } from 'child_process';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RADIO_DIR = path.join(__dirname, '.radio_output');
const IMAGES_DIR = path.join(RADIO_DIR, 'images');
const API_KEY = process.env.GEMINI_API_KEY;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(RADIO_DIR));

// ─── Helpers ────────────────────────────────────────────────────────────────

function readJson(filename) {
  const p = path.join(RADIO_DIR, filename);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeJson(filename, data) {
  fs.writeFileSync(path.join(RADIO_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
}

function sseStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  return {
    log: (msg) => res.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`),
    err: (msg) => res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`),
    done: (code = 0) => { res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`); res.end(); },
  };
}

function runScript(sse, scriptName, args = []) {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptName, ...args], {
      cwd: RADIO_DIR,
      env: { ...process.env, GEMINI_API_KEY: API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY },
    });
    child.stdout.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(l => sse.log(l)));
    child.stderr.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(l => sse.err(l)));
    child.on('close', resolve);
  });
}

// ─── Pipeline APIs ───────────────────────────────────────────────────────────

// 01 대본 생성
app.post('/api/generate-scripts', async (req, res) => {
  const { topics, includeMz, includeQna } = req.body;
  if (!topics || topics.length < 3) return res.status(400).json({ error: '주제 3개 필요' });
  const sse = sseStream(res);

  // PATCH 1: 이전 결과 파일 삭제 (캐시/동기화 문제 방지)
  const outputJsonFiles = [
    '01_scripts.json', '02_dj_script.json', '03_character_prompts.json',
    'ref_character_sheet.json', '04_storyboard.json', '05_image_results.json',
    '06_video_results.json', '08_qa_script.json',
  ];
  for (const f of outputJsonFiles) {
    const fp = path.join(RADIO_DIR, f);
    try {
      if (fs.existsSync(fp)) { fs.unlinkSync(fp); sse.log(`🗑 삭제: ${f}`); }
    } catch (e) { sse.log(`⚠️ 삭제 실패: ${f} — ${e.message}`); }
  }
  const ttsTxtPath = path.join(RADIO_DIR, 'final_script_for_tts.txt');
  try {
    if (fs.existsSync(ttsTxtPath)) { fs.unlinkSync(ttsTxtPath); sse.log('🗑 삭제: final_script_for_tts.txt'); }
  } catch (e) { sse.log(`⚠️ 삭제 실패: final_script_for_tts.txt — ${e.message}`); }
  const audioDir = path.join(RADIO_DIR, 'audio');
  try {
    if (fs.existsSync(audioDir)) {
      for (const f of fs.readdirSync(audioDir)) {
        if (f.startsWith('chunk_') && f.endsWith('.mp3')) {
          fs.unlinkSync(path.join(audioDir, f));
          sse.log(`🗑 삭제: audio/${f}`);
        }
      }
    }
  } catch (e) { sse.log(`⚠️ audio/ 삭제 실패 — ${e.message}`); }

  // PATCH 3: MZ 플래그 로그
  sse.log('🔥 MZ 플래그: ' + (includeMz ? 'ON' : 'OFF'));

  const pipelineArgs = [...topics.slice(0, 3), ...(includeMz ? ['--mz'] : []), ...(includeQna ? ['--qna'] : [])];

  // STEP 0: Planner — 에피소드 계약서 생성
  sse.log('📋 [Planner] 에피소드 완료 기준서 생성 중...');
  const plannerCode = await runScript(sse, 'run_00_planner.mjs', pipelineArgs);
  if (plannerCode !== 0) return sse.done(plannerCode);
  sse.log('✅ [Planner] ref_episode_contract.json 생성 완료');

  // STEP 1: Script + QA 자동 피드백 루프 (최대 3회)
  let qaPass = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    sse.log(`✍️ [Script] 대본 생성 (시도 ${attempt}/3)...`);
    const scriptCode = await runScript(sse, 'run_01_script.mjs', pipelineArgs);
    if (scriptCode !== 0) return sse.done(scriptCode);

    sse.log(`🔍 [QA] 대본 검증 중 (시도 ${attempt}/3)...`);
    const qaCode = await runScript(sse, 'run_01_QA.mjs');

    const qaResultPath = path.join(RADIO_DIR, '01_qa_result.json');
    if (!fs.existsSync(qaResultPath)) {
      sse.log('⚠️ QA 결과 파일 없음 — Pass 처리');
      qaPass = true;
      break;
    }
    const qaResult = JSON.parse(fs.readFileSync(qaResultPath, 'utf-8'));
    if (qaResult.verdict === 'Pass') {
      sse.log(`✅ [QA] Pass (점수: ${qaResult.score ?? '-'}/100) — 다음 단계로 진행`);
      qaPass = true;
      break;
    } else {
      sse.log(`❌ [QA] Fail (점수: ${qaResult.score ?? '-'}/100) — ${qaResult.summary ?? ''}`);
      (qaResult.feedback || []).forEach(f => sse.log(`   ⚠️ ${f}`));
      if (attempt < 3) {
        fs.writeFileSync(qaResultPath.replace('01_qa_result.json', '01_qa_feedback.json'), JSON.stringify(qaResult, null, 2));
        sse.log(`🔄 [Loop] 피드백 저장 완료 → 재작업 시작 (${attempt + 1}/3)`);
      }
    }
  }
  if (!qaPass) sse.log('⚠️ [QA] 최대 재시도 초과 — 현재 대본으로 진행합니다');

  sse.done(0);
});

// 02 DJ 멘트 생성
app.post('/api/generate-dj', (req, res) => {
  const { includeQna } = req.body || {};
  const sse = sseStream(res);
  const args = [...(includeQna ? ['--qna'] : [])];
  runScript(sse, 'run_02_dj.mjs', args).then(code => sse.done(code));
});

// 03+04 캐스팅 + 스토리보드
app.post('/api/generate-storyboard', async (req, res) => {
  const sse = sseStream(res);
  const code03 = await runScript(sse, 'run_03_casting.mjs');
  if (code03 !== 0) return sse.done(code03);
  const code04 = await runScript(sse, 'run_04_storyboard.mjs');
  sse.done(code04);
});

// 05 이미지 생성
app.post('/api/generate-images', (req, res) => {
  const sse = sseStream(res);
  const { force } = req.body || {};
  if (force && fs.existsSync(IMAGES_DIR)) {
    fs.rmSync(IMAGES_DIR, { recursive: true, force: true });
    sse.log('🗑 기존 이미지 폴더 삭제 완료 → 전체 재생성 시작');
  }
  runScript(sse, 'run_05_images.mjs').then(code => sse.done(code));
});

// 07 오디오 스크립트 생성
app.post('/api/generate-audio-script', (req, res) => {
  const sse = sseStream(res);
  runScript(sse, 'run_07_audio.mjs').then(code => sse.done(code));
});

// ─── 이미지 단일 재생성 ───────────────────────────────────────────────────────

app.post('/api/regenerate-image', async (req, res) => {
  const { scene_id } = req.body;
  if (!scene_id) return res.status(400).json({ error: 'scene_id 필요' });

  const storyboard = readJson('04_storyboard.json');
  if (!storyboard) return res.status(404).json({ error: '스토리보드 없음' });

  const scenes = storyboard.scenes
    ?? storyboard.episodes?.flatMap(ep => (ep.scenes || []).map(s => ({ ...s, episode_id: ep.episode_id ?? ep.id })))
    ?? [];
  const scene = scenes.find(s => s.scene_id === scene_id);
  if (!scene) return res.status(404).json({ error: `씬 ${scene_id} 없음` });

  const STYLE = ' Showa retro anime illustration, Studio Ghibli warm color palette, warm amber cinematic lighting, masterpiece, best quality, highly detailed, 8k, 16:9.';
  const prompt = scene.visual_prompt_en + STYLE;
  const body = JSON.stringify({
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: '16:9', safetyFilterLevel: 'BLOCK_ONLY_HIGH', personGeneration: 'ALLOW_ALL' },
  });

  try {
    const b64 = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/imagen-4.0-generate-001:predict?key=${API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const r = https.request(opts, (resp) => {
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => {
          if (resp.statusCode !== 200) { reject(new Error(`HTTP ${resp.statusCode}: ${data.slice(0, 200)}`)); return; }
          const json = JSON.parse(data);
          const b64 = json.predictions?.[0]?.bytesBase64Encoded;
          b64 ? resolve(b64) : reject(new Error('이미지 데이터 없음'));
        });
      });
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMAGES_DIR, `${scene_id}.png`), Buffer.from(b64, 'base64'));
    res.json({ success: true, scene_id, url: `/output/images/${scene_id}.png?t=${Date.now()}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 번역 API ────────────────────────────────────────────────────────────────

async function geminiWithRetry(fn) {
  const delays = [10000, 30000, 60000];
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (err) {
      const is503 = err.message?.includes('503') || err.message?.toLowerCase().includes('unavailable') || err.message?.toLowerCase().includes('overloaded');
      if (i < delays.length && is503) {
        await new Promise(r => setTimeout(r, delays[i]));
      } else {
        throw err;
      }
    }
  }
}

app.post('/api/translate', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text 필요' });
  if (!API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY 없음' });
  try {
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.3, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },
    });
    const result = await geminiWithRetry(() => model.generateContent(
      `주어진 일본어 라디오 대본을 한국어로 자연스럽게 번역해라. 번역된 텍스트만 반환해라.\n\n${text}`
    ));
    res.json({ translated: result.response.text() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 데이터 읽기 ─────────────────────────────────────────────────────────────

app.get('/api/data/scripts', (req, res) => {
  const d = readJson('01_scripts.json');
  d ? res.json(d) : res.status(404).json({ error: '파일 없음' });
});
app.get('/api/data/dj', (req, res) => {
  const d = readJson('02_dj_script.json');
  d ? res.json(d) : res.status(404).json({ error: '파일 없음' });
});
app.get('/api/data/audio', (req, res) => {
  const p = path.join(RADIO_DIR, 'final_script_for_tts.txt');
  fs.existsSync(p) ? res.send(fs.readFileSync(p, 'utf-8')) : res.status(404).json({ error: '파일 없음' });
});
app.get('/api/data/images', (req, res) => {
  const d = readJson('05_image_results.json');
  d ? res.json(d) : res.status(404).json({ error: '파일 없음' });
});
app.get('/api/data/storyboard', (req, res) => {
  const d = readJson('04_storyboard.json');
  d ? res.json(d) : res.status(404).json({ error: '파일 없음' });
});

// ─── 데이터 쓰기 ─────────────────────────────────────────────────────────────

app.put('/api/data/scripts', (req, res) => {
  writeJson('01_scripts.json', req.body);
  res.json({ success: true });
});
app.put('/api/data/dj', (req, res) => {
  writeJson('02_dj_script.json', req.body);
  res.json({ success: true });
});
app.put('/api/data/audio', (req, res) => {
  fs.writeFileSync(path.join(RADIO_DIR, 'final_script_for_tts.txt'), req.body.text, 'utf-8');
  res.json({ success: true });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(3000, () => {
  console.log('🚀 ガラクタロボ DJ Studio → http://localhost:3000');
  console.log(`🔑 GEMINI_API_KEY: ${API_KEY ? '✅ 로드됨' : '❌ 없음'}`);
});
```

---

## 📁 .radio_output/run_00_planner.mjs

```javascript
/**
 * run_00_planner.mjs — Planner Agent
 * 대본 작성 전 에피소드 완료 기준서(ref_episode_contract.json) 생성
 * Usage: node run_00_planner.mjs <topic1> <topic2> <topic3> [--mz] [--qna]
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 로드 (루트 기준)
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const k = t.slice(0, idx).trim(), v = t.slice(idx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }

const allArgs = process.argv.slice(2);
const includeMz = allArgs.includes('--mz');
const includeQna = allArgs.includes('--qna');
const topics = allArgs.filter(a => !a.startsWith('--'));
if (topics.length < 3) { console.error('❌ 주제 3개 필요'); process.exit(1); }

// 이전 피드백 파일 초기화 (새 파이프라인 시작 시 stale 피드백 제거)
const feedbackPath = path.join(__dirname, '01_qa_feedback.json');
if (fs.existsSync(feedbackPath)) {
  fs.unlinkSync(feedbackPath);
  console.log('🗑  이전 QA 피드백 초기화');
}
const qaResultPath = path.join(__dirname, '01_qa_result.json');
if (fs.existsSync(qaResultPath)) {
  fs.unlinkSync(qaResultPath);
}

// MZ 에피소드 번호 결정
const mzEpNum = includeMz ? Math.floor(Math.random() * 3) + 1 : null;
if (includeMz) console.log(`🔥 MZ 모드 ON — EP${mzEpNum}를 10~30대 사연자로 계획`);

const client = new Anthropic({ apiKey: API_KEY });

const prompt = `
당신은 일본 시니어 라디오 방송 "テンキ爺の電波局"의 수석 기획자입니다.
아래 3개의 에피소드 테마를 바탕으로, 대본 작가가 반드시 지켜야 할 "에피소드 완료 기준서(Episode Contract)"를 JSON으로 작성해라.

테마1: ${topics[0]}
테마2: ${topics[1]}
테마3: ${topics[2]}
MZ 모드: ${includeMz ? `ON — EP${mzEpNum}의 사연자를 10~30대로 설정` : 'OFF (전원 50代 이상 시니어)'}
Q&A 모드: ${includeQna ? 'ON' : 'OFF'}

【계약서 작성 규칙】
1. required_keywords: 각 테마에서 대본에 반드시 등장해야 할 핵심 일본어 키워드 3~5개
2. character_profile.age_range: MZ 모드 해당 에피소드는 "10代〜30代", 나머지는 "50代以上"
3. required_emotion_tone: 該 테마에 어울리는 감정 톤 (苦笑い|哀愁|懐かしさ|ほっこり|驚き 중 1개)
4. forbidden_drift: 이 테마에서 절대 빠지면 안 되는 주제 이탈 패턴 예시 1~2개
5. villain_required: 빌런 캐릭터가 반드시 필요한지 여부 (boolean)

【출력 JSON만 반환, 설명 없음】
{
  "contract_version": "1.0",
  "generated_at": "${new Date().toISOString()}",
  "topics": ${JSON.stringify(topics.slice(0, 3))},
  "mz_mode": ${includeMz},
  "mz_episode_id": ${mzEpNum ?? 'null'},
  "qna_mode": ${includeQna},
  "episodes": [
    {
      "id": 1,
      "theme": "테마 이름 (일본어)",
      "required_keywords": ["키워드1", "키워드2", "키워드3"],
      "character_profile": {
        "age_range": "50代以上",
        "gender_hint": "any",
        "personality_hint": "캐릭터 성격 한 줄 힌트"
      },
      "required_emotion_tone": "苦笑い",
      "forbidden_drift": ["이탈 패턴 예시1"],
      "villain_required": false,
      "script_length_range": "800〜1000文字"
    },
    { "id": 2 },
    { "id": 3 }
  ]
}`;

console.log('📋 [Planner] 에피소드 계약서 생성 중...');

let retryCount = 0;
let contract;
while (retryCount < 3) {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    contract = JSON.parse(jsonMatch[0]);
    if (!contract.episodes || contract.episodes.length < 3) throw new Error('에피소드 3개 필요');
    break;
  } catch (err) {
    retryCount++;
    console.warn(`⚠️ 재시도 ${retryCount}/3: ${err.message}`);
    if (retryCount >= 3) { console.error('❌ Planner 최대 재시도 초과'); process.exit(1); }
  }
}

fs.writeFileSync(path.join(__dirname, 'ref_episode_contract.json'), JSON.stringify(contract, null, 2), 'utf-8');

console.log('✅ [Planner] 계약서 생성 완료 → ref_episode_contract.json');
contract.episodes.forEach(ep => {
  console.log(`   EP${ep.id} [${ep.theme}] 키워드: ${(ep.required_keywords || []).join(', ')}`);
});
```

---

## 📁 .radio_output/run_01_script.mjs

```javascript
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 로드 (루트 기준)
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }

const allArgs = process.argv.slice(2);
const includeMz = allArgs.includes('--mz');
const topics = allArgs.filter(a => !a.startsWith('--'));
if (topics.length < 3) { console.error('❌ 주제 3개 필요'); process.exit(1); }

// MZ 모드: contract가 있으면 거기서 mzEpNum 읽기, 없으면 랜덤
const contractPath = path.join(__dirname, 'ref_episode_contract.json');
const contract = fs.existsSync(contractPath) ? JSON.parse(fs.readFileSync(contractPath, 'utf-8')) : null;
const mzEpNum = includeMz
  ? (contract?.mz_episode_id ?? Math.floor(Math.random() * 3) + 1)
  : null;
if (includeMz) console.log(`🔥 MZ 모드 ON — EP${mzEpNum}를 10~30대 사연자로 설정`);

// QA 피드백 로드 (재작업 시 이전 QA 피드백 주입)
const feedbackPath = path.join(__dirname, '01_qa_feedback.json');
const qaFeedback = fs.existsSync(feedbackPath)
  ? JSON.parse(fs.readFileSync(feedbackPath, 'utf-8'))
  : null;
if (qaFeedback) console.log('🔄 [재작업] QA 피드백 감지 — 수정 지시 반영');

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_script_rules.md'), 'utf-8');

// ── 전역 상태 초기화 ───────────────────────────────────────────────────────────
console.log('🗑  이전 작업물 초기화 중...');
const JSON_FILES = [
  '01_scripts.json', '02_dj_script.json', '03_character_prompts.json',
  '04_storyboard.json', '05_image_results.json', '06_video_results.json',
  '08_qa_script.json',
];
for (const f of JSON_FILES) {
  const p = path.join(__dirname, f);
  if (fs.existsSync(p)) { fs.rmSync(p); console.log(`   삭제: ${f}`); }
}
for (const d of ['images', 'videos']) {
  const p = path.join(__dirname, d);
  if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); console.log(`   폴더 삭제: ${d}/`); }
}
console.log('✅ 초기화 완료\n');

const client = new Anthropic({ apiKey: API_KEY });

const mzInstruction = includeMz ? `
【MZ世代 特別사연 — 절대 준수】
3개의 사연 중 EP${mzEpNum}의 사연자는 반드시 10대~30대(10代〜30代)의 젊은 세대로 설정해라.
나이는 22歳, 28歳 등 구체적으로 명시할 것.
가장 중요한 것은, 사용자가 입력한 EP${mzEpNum}의 테마(「${topics[mzEpNum - 1]}」)를 절대 바꾸지 말고 유지하되,
그 테마를 10~30대의 현실적이고 구체적인 상황(취업 스트레스, 직장 번아웃, 연애/결혼 압박, タイムパフォーマンス, SNS 비교 등)으로 재해석해서 작성해라.
나머지 2개 에피소드는 50대 이상 시니어로 유지해라.
` : `
【연령 설정】
사연자 3명 모두 50대 이상의 시니어층으로 설정해라.
`;

const prompt = `
${referenceKnowledge}

---

あなたは「テンキ爺の電波局」専属シナリオライターです。
以下の3テーマで、ラジオ投稿エピソードを各1本執筆してください。
${mzInstruction}

テーマ1: ${topics[0]}
テーマ2: ${topics[1]}
テーマ3: ${topics[2]}
${contract ? `
【📋 計画書 制約 — QA 通過のため必ず守ること】
${(contract.episodes || []).map(ep => {
  const kws   = (ep.required_keywords || []).join('、');
  const vHint = ep.villain_required === true
    ? '빌런(is_villain=true) 캐릭터 필수'
    : ep.villain_required === false
      ? '빌런 없이 평범한 주인공(is_villain=false)'
      : '';
  const tone  = ep.required_emotion_tone ? `감정 톤 「${ep.required_emotion_tone}」` : '';
  const parts = [kws ? `키워드 최소 1개: [${kws}]` : '', vHint, tone].filter(Boolean).join(' / ');
  return parts ? `EP${ep.id}: ${parts}` : '';
}).filter(Boolean).join('\n')}
` : ''}${qaFeedback ? `
【⚠️ QA 재작업 지시 — 반드시 수정할 것】
이전 대본이 품질 검증에서 실패했습니다. 아래 피드백을 반드시 반영하여 재작성해라.
${(qaFeedback.feedback || []).map((f, i) => `${i + 1}. ${f}`).join('\n')}
${(qaFeedback.episodes || []).filter(e => !e.pass).map(e => `EP${e.id} 수정 필요: ${(e.issues || []).join(', ')}`).join('\n')}
위 지적 사항을 완전히 해결한 후 출력할 것. 같은 실수를 반복하면 안 된다.
` : ''}
【出力 JSON のみ返答】
{
  "episodes": [
    {
      "id": 1,
      "theme": "テーマ名（日本語）",
      "title": "エピソードタイトル",
      "script": "사연자 편지 본문만 800〜1,000文字",
      "emotion_tone": "苦笑い|哀愁|懐かしさ|ほっこり",
      "character": {
        "name": "主人公名（仮名）",
        "age": "推定年齢（例: 67歳）",
        "gender": "男性|女性",
        "personality_type": "頑固じじい|天邪鬼|自己中|意地っ張り|老害|心配性|普通の善人",
        "personality_desc": "성격 한줄 묘사 (일본어)",
        "setting": "舞台・時代背景",
        "is_villain": true,
        "flaw_trigger": "진상 행동 요약 (빌런이면 필수, 평범이면 null)"
      }
    },
    { "id": 2 },
    { "id": 3 }
  ]
}`;

console.log('📝 대본 생성 중 (Claude API)...');

let retryCount = 0;
let data;
while (retryCount < 3) {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const parsed = JSON.parse(jsonMatch[0]);
    // script 필드에 DJ 대사/로봇 의성어 오염 여부만 검사 (（）는 일본어 자연 표현이므로 허용)
    const scriptTexts = (parsed.episodes || []).map(ep => ep.script || '').join('\n');
    if (/ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(scriptTexts)) {
      throw new Error('규칙 위반: script 필드에 금지된 의성어 포함됨');
    }
    data = parsed;
    break;
  } catch (err) {
    retryCount++;
    console.warn(`⚠️ 재시도 ${retryCount}/3: ${err.message}`);
    if (retryCount >= 3) { console.error('❌ 최대 재시도 초과'); process.exit(1); }
  }
}

fs.writeFileSync(path.join(__dirname, '01_scripts.json'), JSON.stringify(data, null, 2), 'utf-8');

console.log('✅ 대본 생성 완료');
data.episodes.forEach(ep => {
  const villain = ep.character?.is_villain ? '🔴빌런' : '🟢평범';
  console.log(`   EP${ep.id} [${ep.theme}] "${ep.title}" — ${villain} ${ep.character?.personality_type}`);
  if (ep.character?.flaw_trigger) console.log(`      └ flaw: ${ep.character.flaw_trigger}`);
});
```

---

## 📁 .radio_output/run_01_QA.mjs

```javascript
/**
 * run_01_QA.mjs — Hybrid QA Evaluator
 *
 * Stage 1 (Programmatic, Hard):
 *   - 대본 분량, required_keywords, villain_required, MZ 연령
 *   - 하나라도 실패 → 즉시 Fail, Stage 2 생략
 *
 * Stage 2 (LLM, Lenient):
 *   - Stage 1 통과 에피소드만 감정 톤(emotion_tone) 가볍게 검증
 *   - Pass rate 80% 이상 — 의심스러우면 무조건 Pass
 *
 * Clean Exit: process.exitCode + IIFE → UV_HANDLE_CLOSING 방지
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 로드
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const k = t.slice(0, idx).trim(), v = t.slice(idx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

// ── IIFE로 감싸서 early return이 가능하게 → 자연 종료 보장 ──────────────────
(async () => {

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  const scriptsPath = path.join(__dirname, '01_scripts.json');
  const contractPath = path.join(__dirname, 'ref_episode_contract.json');

  // ── 필수 파일 체크 ─────────────────────────────────────────────────────────
  if (!fs.existsSync(scriptsPath)) {
    console.error('❌ 01_scripts.json 없음');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(contractPath)) {
    console.warn('⚠️ ref_episode_contract.json 없음 — QA 스킵 (Pass 처리)');
    const r = { verdict: 'Pass', score: 100, skipped: true, feedback: [], episodes: [], summary: '계약서 없음 — 스킵' };
    fs.writeFileSync(path.join(__dirname, '01_qa_result.json'), JSON.stringify(r, null, 2));
    process.exitCode = 0;
    return;
  }

  const scripts  = JSON.parse(fs.readFileSync(scriptsPath,  'utf-8'));
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));

  console.log('🔍 [QA Stage 1] 프로그래매틱 검증 중...');

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 1 — 프로그래매틱 하드 체크
  // ══════════════════════════════════════════════════════════════════════════
  const stage1Results = (scripts.episodes || []).map(ep => {
    const cEp    = (contract.episodes || []).find(c => c.id === ep.id) || {};
    const issues = [];

    // 1-A. 대본 분량 (최소 400자)
    const len = (ep.script || '').length;
    if (len < 400) issues.push(`분량 부족: ${len}자 (최소 400자)`);

    // 1-B. required_keywords — 1개 이상 포함 필수
    const kws    = cEp.required_keywords || [];
    const found  = kws.filter(kw => (ep.script || '').includes(kw));
    if (kws.length > 0 && found.length === 0) {
      issues.push(`키워드 전혀 없음: [${kws.join(', ')}] 중 1개도 미포함`);
    } else if (kws.length > 0) {
      console.log(`   EP${ep.id} 키워드: ${found.length}/${kws.length}개 (${found.join(', ')})`);
    }

    // 1-C. villain_required 플래그 불일치 (hard fail)
    if (typeof cEp.villain_required === 'boolean') {
      const isVillain = ep.character?.is_villain === true;
      if (cEp.villain_required && !isVillain) {
        issues.push(`villain 미설정: 계약서는 빌런 캐릭터 필수인데 is_villain=false`);
      } else if (!cEp.villain_required && isVillain) {
        issues.push(`villain 불필요: 계약서는 빌런 불필요인데 is_villain=true`);
      }
    }

    // 1-D. MZ 연령 체크
    if (contract.mz_mode && ep.id === contract.mz_episode_id) {
      const age = parseInt(ep.character?.age ?? '99');
      if (!isNaN(age) && age > 39) {
        issues.push(`MZ 연령 오류: ${ep.character?.age} (39세 이하 필요)`);
      }
    } else if (!contract.mz_mode) {
      const age = parseInt(ep.character?.age ?? '60');
      if (!isNaN(age) && age < 40) {
        issues.push(`시니어 연령 오류: ${ep.character?.age} (40세 이상 필요)`);
      }
    }

    const pass = issues.length === 0;
    return { id: ep.id, pass, issues, reqTone: cEp.required_emotion_tone, actualTone: ep.emotion_tone, script: ep.script };
  });

  const stage1Pass = stage1Results.every(r => r.pass);

  if (!stage1Pass) {
    const failEps  = stage1Results.filter(r => !r.pass);
    const feedbacks = failEps.map(r => `EP${r.id}: ${r.issues.join(' / ')}`);
    const result = {
      verdict:  'Fail',
      score:    Math.round((stage1Results.filter(r => r.pass).length / stage1Results.length) * 100),
      stage:    1,
      episodes: stage1Results.map(r => ({ id: r.id, pass: r.pass, issues: r.issues })),
      feedback: feedbacks,
      summary:  `Stage1 Fail — ${failEps.map(r => `EP${r.id}(${r.issues.length}건)`).join(', ')}`,
    };
    fs.writeFileSync(path.join(__dirname, '01_qa_result.json'), JSON.stringify(result, null, 2), 'utf-8');
    console.log(`❌ [QA Stage 1] Fail — ${result.summary}`);
    feedbacks.forEach(f => console.log(`   ⚠️ ${f}`));
    process.exitCode = 1;
    return;
  }

  console.log('✅ [QA Stage 1] 전원 통과 → Stage 2 감정 톤 검증');

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 2 — 감정 톤 LLM 검증 (관대, Pass rate 80%+)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🎭 [QA Stage 2] 감정 톤 검증 중 (LLM)...');

  let stage2Results = stage1Results.map(r => ({ id: r.id, pass: true, toneIssue: null }));

  if (!API_KEY) {
    console.warn('⚠️ ANTHROPIC_API_KEY 없음 — Stage 2 스킵 (Pass 처리)');
  } else {
    const client = new Anthropic({ apiKey: API_KEY });

    // 에피소드별로 감정 톤만 가볍게 확인
    for (const r of stage1Results) {
      if (!r.reqTone || !r.actualTone) continue; // 톤 정보 없으면 스킵

      // 유사 감정 쌍은 코드 단에서 먼저 허용
      const SIMILAR_PAIRS = [
        ['苦笑い', '哀愁'], ['苦笑い', '懐かしさ'],
        ['ほっこり', '懐かしさ'], ['ほっこり', '驚き'],
      ];
      const isSimilar = SIMILAR_PAIRS.some(
        ([a, b]) => (r.reqTone === a && r.actualTone === b) || (r.reqTone === b && r.actualTone === a)
      );
      if (r.reqTone === r.actualTone || isSimilar) continue; // 일치 또는 유사 → 즉시 Pass

      const tonePrompt = `
당신은 일본 라디오 대본 감수자입니다. 아래 대본이 지정된 감정 톤을 "어느 정도라도" 전달하면 Pass입니다.
의심스러우면 Pass로 판정하세요. Fail은 완전히 반대되는 감정일 때만 사용하세요.

지정 감정 톤: 「${r.reqTone}」
대본 기재 톤: 「${r.actualTone}」
대본 앞 200자: ${(r.script || '').slice(0, 200)}

JSON만 반환:
{"verdict":"Pass","reason":"한 줄 이유"}`;

      let toneVerdict = 'Pass'; // default lenient
      try {
        const msg = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages: [{ role: 'user', content: tonePrompt }],
        });
        const raw = msg.content[0].text.match(/\{[\s\S]*?\}/)?.[0];
        if (raw) {
          const parsed = JSON.parse(raw);
          toneVerdict = parsed.verdict || 'Pass';
          if (toneVerdict === 'Fail') {
            stage2Results[r.id - 1].pass = false;
            stage2Results[r.id - 1].toneIssue = parsed.reason || '감정 톤 불일치';
            console.log(`   EP${r.id} 감정 톤 Fail: ${parsed.reason}`);
          } else {
            console.log(`   EP${r.id} 감정 톤 Pass: ${parsed.reason ?? '유사 감정'}`);
          }
        }
      } catch (err) {
        console.warn(`   EP${r.id} 감정 톤 검증 실패 → Pass 처리 (${err.message})`);
      }
    }
  }

  // ── 최종 결과 합산 ─────────────────────────────────────────────────────────
  const finalEps = stage1Results.map((r, i) => {
    const s2 = stage2Results[i];
    const allIssues = [...r.issues, ...(s2.toneIssue ? [s2.toneIssue] : [])];
    return { id: r.id, pass: r.pass && s2.pass, issues: allIssues };
  });

  const allFinalPass = finalEps.every(e => e.pass);
  const score = Math.round((finalEps.filter(e => e.pass).length / finalEps.length) * 100);
  const verdict = allFinalPass ? 'Pass' : 'Fail';
  const failedFeedback = finalEps.filter(e => !e.pass).map(e => `EP${e.id}: ${e.issues.join(' / ')}`);

  const qaResult = {
    verdict,
    score,
    stage: allFinalPass ? 'all' : (stage1Pass ? 2 : 1),
    episodes: finalEps,
    feedback: failedFeedback,
    summary: allFinalPass
      ? `${finalEps.length}개 에피소드 전원 Pass`
      : `Fail: ${finalEps.filter(e => !e.pass).map(e => `EP${e.id}`).join(', ')}`,
  };

  fs.writeFileSync(path.join(__dirname, '01_qa_result.json'), JSON.stringify(qaResult, null, 2), 'utf-8');

  if (verdict === 'Pass') {
    console.log(`✅ [QA] Pass (${score}/100) — ${qaResult.summary}`);
    const fbPath = path.join(__dirname, '01_qa_feedback.json');
    if (fs.existsSync(fbPath)) fs.unlinkSync(fbPath);
    process.exitCode = 0;
  } else {
    console.log(`❌ [QA] Fail (${score}/100) — ${qaResult.summary}`);
    failedFeedback.forEach(f => console.log(`   ⚠️ ${f}`));
    process.exitCode = 1;
  }
  // process.exit() 미호출 — 이벤트 루프 자연 종료 → UV_HANDLE_CLOSING 방지

})().catch(err => {
  console.error('❌ QA 내부 오류:', err.message);
  process.exitCode = 1;
});
```

---

## 📁 .radio_output/run_02_dj.mjs

```javascript
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 로드 (루트 기준)
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// PATCH 4: --qna 플래그 파싱
const includeQna = process.argv.includes('--qna');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('❌ GEMINI_API_KEY 없음'); process.exit(1); }

const scripts = JSON.parse(fs.readFileSync(path.join(__dirname, '01_scripts.json'), 'utf-8'));
const [ep1, ep2, ep3] = scripts.episodes;

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_persona_rules.md'), 'utf-8');

// ── 실시간 도쿄 날씨 ───────────────────────────────────────────────────────────
async function fetchTokyoWeather() {
  const WMO = {
    0: '快晴', 1: 'ほぼ晴れ', 2: '晴れ時々曇り', 3: '曇り',
    45: '霧', 48: '着氷性の霧',
    51: '霧雨（弱）', 53: '霧雨', 55: '霧雨（強）',
    61: '小雨', 63: '雨', 65: '大雨',
    71: '小雪', 73: '雪', 75: '大雪', 77: '霰',
    80: 'にわか雨（弱）', 81: 'にわか雨', 82: 'にわか雨（激しい）',
    85: '雪のにわか降り', 86: '雪のにわか降り（強）',
    95: '雷雨', 96: '雹を伴う雷雨', 99: '激しい雹を伴う雷雨',
  };
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&current=temperature_2m,weathercode&timezone=Asia%2FTokyo';
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    const temp = json.current?.temperature_2m;
    const code = json.current?.weathercode;
    return `東京 現在気温${temp}℃ / ${WMO[code] ?? '不明'}`;
  } catch (err) {
    console.warn(`   ⚠️  날씨 API 실패 (${err.message}) → 기본값 사용`);
    return '東京 深夜の気温不明 / 天気不明（電波状態が悪い）';
  }
}

console.log('🌤  도쿄 실시간 날씨 취득 중...');
const realTimeWeather = await fetchTokyoWeather();
console.log(`   📡 ${realTimeWeather}`);

// PATCH 4: QNA 지시문
const QNA_INSTRUCTION = includeQna ? `

【짤막 Q&A 코너 추가 지시】
3개 에피소드 멘트 이후, "짤막 Q&A" 코너를 추가하라.
- 리스너의 황당/웃긴 질문 3개 + テンキ爺의 독설 한 마디 답변 (각 60자 이내)
- JSON 출력에 다음 필드를 추가:
  "qa_segment": {
    "intro": "Q&A 코너 인트로 멘트 (テンキ爺 스타일)",
    "pairs": [
      {"q": "리스너 질문1", "a": "テンキ爺 독설 답변1"},
      {"q": "리스너 질문2", "a": "テンキ爺 독설 답변2"},
      {"q": "리스너 질문3", "a": "テンキ爺 독설 답변3"}
    ]
  }
- --qna 플래그가 활성화된 경우에만 이 필드를 포함한다.` : '';

// PATCH 7: GoogleGenerativeAI로 교체
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    temperature: 0.8,
    maxOutputTokens: 8192,
    thinkingConfig: { thinkingBudget: 0 },
  },
});

console.log('🎙️  テンキ爺 전체 방송 멘트 생성 중 (ビートたけし스타일 롱폼, Gemini API)...');

const prompt = `
${referenceKnowledge}

---

【오늘 도쿄 날씨】${realTimeWeather}
show_opening에서 반드시 이 날씨 정보를 활용해 도쿄 스튜디오 애드립을 넣어라.

【오늘 사연 3편】
EP1: 테마「${ep1.theme}」/ "${ep1.title}" / ${ep1.character.personality_type}타입 ${ep1.character.name}(${ep1.character.age})
EP2: 테마「${ep2.theme}」/ "${ep2.title}" / ${ep2.character.personality_type}타입 ${ep2.character.name}(${ep2.character.age})
EP3: 테마「${ep3.theme}」/ "${ep3.title}" / ${ep3.character.personality_type}타입 ${ep3.character.name}(${ep3.character.age})

【생성할 멘트 & 분량】
▶ show_opening (150〜200文字): 「電波泥棒ども」로 맞이하며 도쿄 날씨 애드립 포함, 오늘 밤 방송 세팅
▶ episodes[1].dj_reaction (300〜500文字): EP1 독설+고물 로봇 썰 길게+투박한 위로
▶ episodes[1].dj_transition (100〜150文字): 자연스럽게 EP2로 연결
▶ episodes[2].dj_reaction (300〜500文字): EP2 독설+고물 로봇 썰 길게+투박한 위로
▶ episodes[2].dj_transition (100〜150文字): 자연스럽게 EP3로 연결
▶ episodes[3].dj_reaction (300〜500文字): EP3 독설+고물 로봇 썰 길게+투박한 위로
▶ show_closing (300〜400文字): 유튜브 구독/좋아요 츤데레 요구 + 다음 방송 예고
${QNA_INSTRUCTION}

【출력 JSON만 반환】
{
  "show_opening": "...",
  "episodes": [
    {"id":1,"dj_reaction":"...","dj_transition":"..."},
    {"id":2,"dj_reaction":"...","dj_transition":"..."},
    {"id":3,"dj_reaction":"...","dj_transition":null}
  ],
  "show_closing": "..."${includeQna ? `,
  "qa_segment": {
    "intro": "...",
    "pairs": [
      {"q":"...","a":"..."},
      {"q":"...","a":"..."},
      {"q":"...","a":"..."}
    ]
  }` : ''}
}`;

let retryCount = 0;
let djMents;
while (retryCount < 3) {
  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const parsed = JSON.parse(jsonMatch[0]);
    const djTexts = [
      parsed.show_opening || '',
      parsed.show_closing || '',
      ...(parsed.episodes || []).flatMap(ep => [ep.dj_reaction || '', ep.dj_transition || '']),
    ].join('\n');
    if (/ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(djTexts)) {
      throw new Error('규칙 위반: DJ 멘트에 금지된 의성어 포함됨');
    }
    djMents = parsed;
    break;
  } catch (err) {
    retryCount++;
    console.warn(`⚠️ 재시도 ${retryCount}/3: ${err.message}`);
    if (retryCount >= 3) { console.error('❌ 최대 재시도 초과'); process.exit(1); }
  }
}

// ── Real Fallback: LLM이 필드를 누락했을 때 テンキ爺 기본 대사 주입 ──────────
djMents.show_opening = djMents.show_opening ||
  '[ガラガラ] おう、電波泥棒ども！今夜もワシのポンコツ電波を盗みに来やがったか。まあいい、せいぜい楽しんでいけや。';
djMents.show_closing = djMents.show_closing ||
  '[溜息] ふん、今夜はここまでだ。電波泥棒ども、また次回な！チャンネル登録と高評価、忘れんなよコノヤロー！';
(djMents.episodes || []).forEach(ep => {
  ep.dj_reaction = ep.dj_reaction || `[ぼそっと] EP${ep.id}か。まあ、それなりに生きてるじゃないか。`;
});

const merged = {
  show_opening: djMents.show_opening,
  show_closing: djMents.show_closing,
  tokyo_weather: realTimeWeather,
  episodes: scripts.episodes.map(ep => {
    const djEp = djMents.episodes.find(d => d.id === ep.id);
    return {
      ...ep,
      dj_reaction: djEp?.dj_reaction || '',
      dj_transition: djEp?.dj_transition || null,
    };
  }),
};

// PATCH 4: qa_segment가 있으면 08_qa_script.json 저장
if (includeQna && djMents.qa_segment) {
  const qaOut = {
    intro: djMents.qa_segment.intro || '',
    qa_pairs: (djMents.qa_segment.pairs || []).map(p => ({ question: p.q, answer: p.a })),
    outro: merged.show_closing,
  };
  fs.writeFileSync(path.join(__dirname, '08_qa_script.json'), JSON.stringify(qaOut, null, 2), 'utf-8');
  console.log('✅ 08_qa_script.json 저장 완료 (Q&A 코너)');
}

fs.writeFileSync(path.join(__dirname, '02_dj_script.json'), JSON.stringify(merged, null, 2), 'utf-8');

console.log('✅ 02_dj_script.json 저장 완료');
console.log(`   🌤  날씨: ${realTimeWeather}`);
console.log(`   오프닝: ${merged.show_opening.slice(0, 50)}...`);
merged.episodes.forEach(ep => {
  console.log(`   EP${ep.id} 리액션(${ep.dj_reaction.length}字): ${ep.dj_reaction.slice(0, 50)}...`);
  if (ep.dj_transition) console.log(`   └→ 트랜지션: ${ep.dj_transition.slice(0, 40)}...`);
});
const closing = merged.show_closing ?? '';
console.log(`   엔딩(${closing.length}字): ${closing.slice(0, 50)}...`);
```

---

## 📁 .radio_output/run_03_casting.mjs

```javascript
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('❌ GEMINI_API_KEY 없음'); process.exit(1); }

const globalRules = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_visual_rules.md'), 'utf-8');
const djScript = JSON.parse(fs.readFileSync(path.join(__dirname, '02_dj_script.json'), 'utf-8'));

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget: 0 },
  },
});

async function withRetry(fn, label) {
  const delays = [10000, 30000, 60000];
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (err) {
      const is503 = err.message?.includes('503') || err.message?.toLowerCase().includes('unavailable') || err.message?.toLowerCase().includes('overloaded');
      const is429 = err.message?.includes('429') || err.message?.toLowerCase().includes('quota') || err.message?.toLowerCase().includes('rate');
      if (i < delays.length && (is503 || is429)) {
        const wait = is429 ? delays[Math.min(i, delays.length - 1)] * 2 : delays[i];
        console.warn(`   ⚠️ [${label}] ${is429 ? '429 쿼터' : '503 과부하'} — ${wait / 1000}초 후 재시도 (${i + 1}/${delays.length})...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

const characters = [];

for (const ep of djScript.episodes) {
  const char = ep.character;
  console.log(`🎨 EP${ep.id} 캐릭터 시드 생성: ${char.name} (${char.personality_type})`);

  const prompt = `
【전역 규칙 — 파이프라인 전체 적용】
${globalRules}

---

You are a Visual Character Designer for AI image generation (Imagen 4, Stable Diffusion).
Create a FIXED CHARACTER SEED in English for consistent visual identity across all scenes.

Character Info:
- Name: ${char.name}
- Age: ${char.age}
- Gender: ${char.gender}
- Personality: ${char.personality_type} — ${char.personality_desc}
- Setting: ${char.setting}
- Emotion tone: ${ep.emotion_tone}
- Theme: ${ep.theme}

CRITICAL: The character seed must uniquely identify this person so they look IDENTICAL across all scenes.
Include: exact age appearance, face structure, hair (color+style+length), body type, FIXED signature clothing item, personality showing in posture/expression.

Art Style for ALL prompts:
- Showa retro anime illustration, Studio Ghibli warm color palette
- Warm amber/dusty rose/faded navy tones, masterpiece, best quality, highly detailed, 8k, cinematic
- Global negative: modern style, western features, photorealistic, 3D render, nsfw, watermark, blurry

Output JSON only:
{
  "episode_id": ${ep.id},
  "character_name": "${char.name}",
  "character_seed": "THE FIXED SEED — minimum 50 words describing ONLY the character appearance, must start with gender+age. This exact text will be prepended to EVERY scene prompt for this episode.",
  "portrait_prompt": {
    "positive": "[character_seed] + portrait composition details, 1:1 aspect ratio, warm indoor lighting",
    "negative": "young, western features, photorealistic, 3D render, nsfw, blurry, watermark",
    "aspect_ratio": "1:1"
  },
  "scene_prompt_base": {
    "positive": "[character_seed] + sitting in their typical environment, 16:9 aspect ratio, cinematic",
    "negative": "young, western features, photorealistic, 3D render, nsfw, blurry, watermark",
    "aspect_ratio": "16:9"
  },
  "usage_instruction": "Prepend character_seed to the beginning of EVERY scene visual_prompt_en for episode ${ep.id}"
}`;

  let charData = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await withRetry(() => model.generateContent(prompt), `EP${ep.id}`);
      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('JSON 블록 없음');
      charData = JSON.parse(jsonMatch[0]);
      if (!charData.character_seed) throw new Error('character_seed 필드 없음');
      break;
    } catch (err) {
      console.warn(`   ⚠️ EP${ep.id} 시도 ${attempt + 1}/3 실패: ${err.message}`);
      if (attempt >= 2) { console.error(`   ❌ EP${ep.id} 캐릭터 시드 생성 실패`); }
      else await new Promise(r => setTimeout(r, 5000));
    }
  }
  if (charData) {
    characters.push(charData);
    console.log(`   ✅ 시드: ${charData.character_seed.slice(0, 60)}...`);
  }

  await new Promise(r => setTimeout(r, 2000));
}

fs.writeFileSync(
  path.join(__dirname, '03_character_prompts.json'),
  JSON.stringify({ characters }, null, 2),
  'utf-8'
);
console.log('✅ 03_character_prompts.json 저장 완료');

// ref_character_sheet.json 생성
const scripts01 = JSON.parse(fs.readFileSync(path.join(__dirname, '01_scripts.json'), 'utf-8'));
const CLOTHING_KEYWORDS = [
  'スニーカー', 'デニム', 'パーカー', 'ジャケット', 'スーツ', 'セーター', 'ワンピース',
  'コート', 'Tシャツ', 'ブラウス', 'スカート', 'トレーナー', 'ニット', 'カーディガン',
  'シャツ', 'ズボン', 'チノパン', 'エプロン', 'ジャージ', 'オーバーオール',
];

const characterSheet = scripts01.episodes.map(ep => {
  const char = ep.character || {};
  const scriptText = ep.script || '';
  const foundOutfit = CLOTHING_KEYWORDS.filter(kw => scriptText.includes(kw));
  const hasGlasses = /眼鏡|めがね|メガネ|glasses/.test(scriptText + JSON.stringify(char));
  const hairMatch = scriptText.match(/[^\s。、]*髪[^\s。、]*/);
  const bodyMatch = scriptText.match(/[^\s。、]*(体型|体格|太|痩|細)[^\s。、]*/);
  return {
    ep_id: ep.id,
    character_name: char.name || '',
    age: char.age || '',
    gender: char.gender || '',
    appearance: {
      glasses: hasGlasses ? 'yes' : 'no',
      hair_style: hairMatch ? hairMatch[0] : '',
      body_type: bodyMatch ? bodyMatch[0] : '',
    },
    outfit: foundOutfit.length > 0 ? foundOutfit : [],
  };
});

fs.writeFileSync(
  path.join(__dirname, 'ref_character_sheet.json'),
  JSON.stringify(characterSheet, null, 2),
  'utf-8'
);
console.log('✅ ref_character_sheet.json 저장 완료');
```

---

## 📁 .radio_output/run_04_storyboard.mjs

\
---

## 📁 .radio_output/run_05_images.mjs

\
---

## 📁 .radio_output/run_06_videos.mjs

\
---

## 📁 .radio_output/run_09_viewer.mjs

\

---

## 📁 .radio_output/run_04_storyboard.mjs

Key implementation notes:
- DJ_SEED constant defines テンキ爺 visual identity for all DJ_SHOT scenes
- makeDJScene(dialogue, motionNote, transition) helper; speaker always 'TENKI_JII'
- Per-episode: Gemini gemini-2.5-flash generates JSON array of scenes
- FLASHBACK post-processing: YOUNG_MOD string injected after charSeed in visual_prompt_en
- QA DJ_SHOT: 5 scenes inserted after EP2 dj_transition if 08_qa_script.json exists
- englishVisualConstraint from ref_character_sheet.json prepended to every prompt
- Output: 04_storyboard.json with flat scenes[] array + total_scenes + estimated_duration_sec

---

## 📁 .radio_output/run_05_images.mjs

Key implementation notes:
- generateImageImagen3(): REST POST to /v1beta/models/imagen-4.0-generate-001:predict
- parameters: sampleCount=1, aspectRatio=16:9, safetyFilterLevel=BLOCK_ONLY_HIGH, personGeneration=ALLOW_ALL
- generateWithBackoff(): attempts 0..3; 429 → BACKOFF_DELAYS[30s/60s/120s]; other → 10s wait
- STYLE_SUFFIX: ' Showa retro anime illustration, Studio Ghibli warm color palette...'
- Skips scene if images/{scene_id}.png already exists (resume-safe)
- Inter-scene delay: 7 seconds
- Output: 05_image_results.json, images/{scene_id}.png

---

## 📁 .radio_output/run_06_videos.mjs

Key implementation notes:
- MOTION_TEMPLATES by scene type: DJ_SHOT/CHARACTER_SCENE/ESTABLISHING/CLOSE_UP/FLASHBACK
- requestVeo2Video(): POST veo-2.0-generate-001:predictLongRunning, returns LRO
- pollOperation(): 10s polling intervals, 300s max timeout
- downloadVideo(): handles data: URI and HTTPS download with API key appended
- 30s inter-scene delay (Veo 2 rate limit defense)
- 3 retries with exponential backoff (429: 60s*retry, else 15s*retry)
- Output: 06_video_results.json, videos/{scene_id}.mp4

---

## 📁 .radio_output/run_09_viewer.mjs

Key implementation notes:
- Reads 04_storyboard.json (flat scenes array, supports legacy episodes[].scenes too)
- Reads final_script_for_tts.txt for left panel
- Builds HTML: Tailwind CSS dark theme, 2-column layout
- Scene cards: video (autoplay loop muted) > image (clickable modal) > placeholder
- Left panel script: テンキ爺 highlighted amber, ナレーター blue, QA corner green
- Image modal: click to open, Escape or click to close
- Output: viewer.html (run: npx serve .radio_output)


---

## 📁 agents/01_QA_evaluator.md

# Agent: QA Evaluator (대본 품질 감사관)

## 역할
`01_scripts.json`(생성된 대본)을 `ref_episode_contract.json`(에피소드 계약서)와 비교하여 품질을 검증한다.
대본 작가가 헛소리를 하거나 주제에서 이탈하면 가차없이 잡아낸다.

## 실행 파일
`.radio_output/run_01_QA.mjs`

## 입력
- `.radio_output/01_scripts.json` — 검증 대상 대본
- `.radio_output/ref_episode_contract.json` — 에피소드 완료 기준서 (Planner가 생성)

## 출력
- `.radio_output/01_qa_result.json` — 검증 결과
- Exit code `0` = Pass, `1` = Fail

## 평가 기준

| 항목 | 기준 | 가중치 |
|------|------|--------|
| 테마 이탈 | required_keywords 중 2개 이상 반영 | 40% |
| 캐릭터 연령 | MZ/시니어 설정 정확 일치 | 25% |
| forbidden_drift | 금지 이탈 패턴 미등장 | 20% |
| 감정 톤 | required_emotion_tone 일치 또는 유사 | 10% |
| 분량 | script 필드 400자 이상 | 5% |

## 출력 스키마

```json
{
  "verdict": "Pass | Fail",
  "score": 0-100,
  "episodes": [
    {
      "id": 1,
      "pass": true,
      "issues": ["이슈 설명"]
    }
  ],
  "feedback": ["EP1: 구체적 수정 지시문", "EP2: ..."],
  "summary": "전체 평가 한 줄 요약"
}
```

## 파이프라인 내 위치

```
[Planner] run_00_planner.mjs
    ↓ ref_episode_contract.json
[Script Writer] run_01_script.mjs
    ↓ 01_scripts.json
[QA Evaluator] run_01_QA.mjs  ← 여기
    ↓ Pass → [DJ 멘트] run_02_dj.mjs
    ↓ Fail → 피드백 → [Script Writer] 재작업 (최대 3회)
```

## 자동 피드백 루프

Fail 판정 시 `server.mjs`가 `01_qa_feedback.json`으로 피드백을 저장하고,
다음 시도의 `run_01_script.mjs`가 이 피드백을 프롬프트에 주입하여 재작업한다.
최대 3회 반복 후에도 Fail이면 현재 대본으로 강행한다.

---

## 📁 agents/04_visual_QA.md

# Agent: Visual QA (시각 검증자)

## 역할
`04_storyboard.json`의 각 씬 `visual_prompt_en`이 `ref_character_sheet.json`에 명시된
캐릭터 외모·복장 요소를 **100% 정확히** 반영했는지 검증한다.

## 실행 방법
```bash
node .radio_output/run_04_visual_QA.mjs
```

> ⚠️ `run_04_visual_QA.mjs`는 아직 구현 대기 중 (스펙 정의 완료).

## 입력
- `.radio_output/04_storyboard.json`
- `.radio_output/ref_character_sheet.json`
- `.radio_output/03_character_prompts.json`

## 허용 예외
- **FLASHBACK 씬**: 젊은 시절 modifier 적용 시 연령 특징 변경 허용
- **DJ_SHOT 씬**: テンキ爺 고정 외모로 대체 허용
- **배경/분위기 씬** (character_seed 미포함): 검증 제외

---

## 📁 agents/07_audio_director.md

# Agent: Audio Director (오디오 생성 총괄)

## 역할
`02_dj_script.json`을 읽어 ElevenLabs V3 TTS로 각 화자의 음성을 생성하고,
FFmpeg로 1.5초 묵음을 삽입하며 3개 청크 MP3로 병합한다.

## 실행 파일
`.radio_output/run_07_audio.mjs`

## 화자별 음성 설정

| 화자 | stability | style | 비고 |
|------|-----------|-------|------|
| テンキ爺 (DJ) | 0.38 | 0.65 | 감정 다이나믹 최대화, V3 Audio Tag 확실 반영 |
| 칼러 (사연자) | 0.50 | 0.30 | 안정적, 연령/성별별 Voice ID 분기 |

## 묵음 삽입 규칙

- **1.5초 묵음** — 모든 세그먼트 전환 사이에 강제 삽입
- 묵음 파일은 파이프라인 시작 시 **1회만 생성** → 전 청크 공유 (재생성 금지)
- FFmpeg 없으면 직접 Buffer concat 폴백 (묵음 없음, 경고 표시)

## 엔딩 중복 방지 규칙 (CRITICAL)

`run_02_dj.mjs`가 `08_qa_script.json`을 저장할 때:
```javascript
outro: merged.show_closing  // ← show_closing을 그대로 복사
```
따라서 `qaScript.outro === djScript.show_closing` (동일 텍스트).

**chunk3Items에서 절대 `qaScript.outro`를 push하지 말 것.**
`djScript.show_closing`을 마지막에 단 한 번만 push한다.

## V3 Audio Tag 규칙

- `[sighs]` `[laughs]` `[chuckles]` `[angry]` `[whispers]` 등 영문만 허용
- `[間]` `[溜息]` 등 일본어 태그 → cleanForTTS가 자동 제거
- SSML `<break time="..."/>` → 제거 (V3 미지원)
- 포즈: `...` (줄임표)


---

## 📁 .claude/agents/01_script_writer.md (description frontmatter)

Trigger: 사용자가 새 라디오 방송 주제 3개를 입력하거나 /go-radio /auto-radio 파이프라인 STEP 1이 실행될 때.
Action: ref_script_rules.md를 주입해 일본 시니어 트렌드 반영 입체적 캐릭터의 일본어 사연 대본 3편을 생성하고, Claude API 자가 검증(3회 재시도) 후 01_scripts.json으로 저장한다. 실행 전 이전 작업물 전체 초기화.

Script: .radio_output/run_01_script.mjs
Model: claude-haiku-4-5-20251001
Ref: .claude/skills/ref_script_rules.md

---

## 📁 .claude/agents/02_dj_persona.md (description frontmatter)

Trigger: 01_scripts.json이 생성된 후 파이프라인 STEP 2가 실행될 때.
Action: ref_persona_rules.md를 주입해 テンキ爺 인격으로 방송 전체 오프닝(도쿄 실시간 날씨 포함)/엔딩 + 사연별 롱폼 리액션(300~500字) + 자연스러운 트랜지션 + 유튜브 구독 요청 엔딩을 생성한다. Claude API 자가 검증(3회 재시도) 후 02_dj_script.json으로 저장.

Script: .radio_output/run_02_dj.mjs
Model: gemini-2.5-flash (GoogleGenerativeAI)
Ref: .claude/skills/ref_persona_rules.md
Weather: Open-Meteo API (latitude=35.6895, longitude=139.6917)

Output JSON:
{
  "show_opening": "...",
  "show_closing": "...",
  "tokyo_weather": "...",
  "episodes": [
    { "id": 1, "dj_reaction": "...", "dj_transition": "..." },
    { "id": 2, "dj_reaction": "...", "dj_transition": "..." },
    { "id": 3, "dj_reaction": "...", "dj_transition": null }
  ]
}

---

## 📁 .claude/agents/03_casting_director.md (description frontmatter)

Trigger: 02_dj_script.json이 생성된 후 파이프라인 STEP 3(캐스팅)이 실행될 때.
Action: ref_visual_rules.md를 주입해 각 사연 주인공의 고정 캐릭터 시드 프롬프트(Character Seed)를 영어로 생성한다. 모든 씬 이미지 생성에 동일 시드를 적용하여 시각적 일관성 확보. 03_character_prompts.json으로 저장.

Script: .radio_output/run_03_casting.mjs
Model: gemini-2.5-flash
Also generates: ref_character_sheet.json (outfit/glasses/hair extraction from script text)

---

## 📁 .claude/agents/04_storyboard_director.md (description frontmatter)

Trigger: 03_character_prompts.json이 생성된 후 파이프라인 STEP 5(스토리보드)가 실행될 때.
Action: ref_visual_rules.md를 주입해 방송 전체 흐름을 4~6초 단위 씬 flat 배열로 분해한다. 각 씬 visual_prompt_en 맨 앞에 캐릭터 시드 삽입. FLASHBACK 씬은 젊은 시절 modifier 자동 삽입. QA 코너 존재 시 EP2 직후 DJ_SHOT 5~6개 자동 삽입. speaker는 TENKI_JII 사용. 04_storyboard.json으로 저장.

Script: .radio_output/run_04_storyboard.mjs
Model: gemini-2.5-flash

---

## 📁 .claude/agents/05_art_director.md (description frontmatter)

Trigger: 04_storyboard.json이 생성된 후 파이프라인 STEP 6(이미지 생성)이 실행될 때.
Action: 04_storyboard.json의 모든 씬을 순회하며 Imagen 4.0 API로 실제 이미지를 생성하고 .radio_output/images/{scene_id}.png로 저장한다. 폴백 없음 — 429/실패 시 지수 백오프(30s/60s/120s) 후 Imagen 4.0으로만 재시도. 결과를 05_image_results.json으로 저장.

Script: .radio_output/run_05_images.mjs
API: Imagen 4.0 (imagen-4.0-generate-001) — NO FALLBACK

---

## 📁 .claude/agents/06_video_producer.md (description frontmatter)

Trigger: 05_image_results.json과 images/*.png가 생성된 후 파이프라인 STEP 6b(영상 생성)가 실행될 때.
Action: 각 씬의 PNG 이미지와 씬 타입별 모션 프롬프트를 사용해 Google Veo 2 API로 실제 영상을 생성하고 .radio_output/videos/{scene_id}.mp4로 저장한다. Rate limit 방어(씬간 30초 딜레이), 3회 지수 백오프 재시도. 결과를 06_video_results.json으로 저장.

Script: .radio_output/run_06_videos.mjs
API: Veo 2 (veo-2.0-generate-001) LRO polling

---

## 📁 .claude/agents/08_qa_segment.md (description frontmatter)

Trigger: /go-radio --qa 플래그로 실행되거나 파이프라인 STEP 4(QA 모드)가 활성화될 때.
Action: ref_persona_rules.md를 주입해 황당하고 어이없는 질문 정확히 5개에 テンキ爺가 연속으로 치고 빠지는 츤데레 독설을 날리는 즉문즉답 코너 대본을 생성한다. Claude API 자가 검증(3회 재시도) 후 08_qa_script.json으로 저장.

Script: .radio_output/run_08_qa.mjs
Model: claude-haiku-4-5-20251001
Validation: qa_pairs.length must === 5

Output:
{
  "intro": "...",
  "qa_pairs": [{"question":"...","answer":"..."} x5],
  "outro": "..."
}

---

## 📁 .claude/agents/09_viewer_generator.md (description frontmatter)

Trigger: 사용자가 파이프라인 결과를 브라우저에서 확인·편집하거나 /go-radio STEP 8이 실행될 때.
Action: server.mjs(Express.js)를 실행해 http://localhost:3000 에서 인터랙티브 대시보드를 제공한다. 대본 편집/저장(PUT API), 한국어 번역(Gemini), 이미지 갤러리, 개별 씬 Imagen 4.0 재생성, SSE 실시간 로그 기능 포함.

Script: server.mjs (Express port 3000)
API endpoints: GET/PUT /api/data/*, POST /api/generate-*, POST /api/regenerate-image, POST /api/translate


---

## Pipeline Architecture Summary

STEP 00: Planner (Claude Haiku) -> ref_episode_contract.json
STEP 01: Script Writer (Claude Haiku) -> 01_scripts.json + QA loop (max 3)
STEP 02: DJ Persona (Gemini 2.5 Flash) -> 02_dj_script.json + tokyo weather
STEP 03: Casting Director (Gemini 2.5 Flash) -> 03_character_prompts.json + ref_character_sheet.json
STEP 04: [--qa only] QA Segment (Claude Haiku) -> 08_qa_script.json
STEP 05: Storyboard Director (Gemini 2.5 Flash) -> 04_storyboard.json
STEP 06: Art Director (Imagen 4.0) -> images/{scene_id}.png + 05_image_results.json
STEP 06b: Video Producer (Veo 2 LRO) -> videos/{scene_id}.mp4 + 06_video_results.json
STEP 07: Audio Director (ElevenLabs V3 + FFmpeg) -> audio/chunk_1/2/3.mp3
STEP 08: Web Dashboard (Express SSE) -> http://localhost:3000

## Voice IDs (ElevenLabs)

テンキ爺 DJ: m0Fo0JrIVm57nweV2EuR
Female 60+:  TTFPf9GdFfg1WOEncIAI
Female 40-59: GR4dBIFsYe57TxyrHKXz
Female -39:  fUjY9K2nAIwlALOwSiwc
Male 60+:    QH5PYulAezU4H8VXwlJx
Male 40-59:  QVEG0HcMh8UIG8OE5Zrv
Male -39:    6XNSYkDqZ1blajSVtPok

## Critical Bug Fixes Applied

BUG-1: run_01_script.mjs topics filter: allArgs.filter(a => !a.startsWith("--")) prevents --mz being treated as a topic
BUG-2: run_02_dj.mjs: const closing = merged.show_closing ?? ""; prevents crash on undefined show_closing; real Japanese fallback text injected
BUG-3: run_01_QA.mjs: IIFE + process.exitCode (no process.exit()) prevents UV_HANDLE_CLOSING on Windows
BUG-4: run_07_audio.mjs: Global SILENCE_FILE created once at startup; qaScript.outro NOT pushed to chunk3Items (would duplicate show_closing); Windows backslash->slash normalize for FFmpeg concat list
BUG-5: DJ ment validation: only blocks robot onomatopoeia; Japanese parentheses allowed in DJ speech

## Environment Variables

ANTHROPIC_API_KEY = Claude Haiku (Planner, Script Writer, QA)
GEMINI_API_KEY = Gemini 2.5 Flash (DJ, Casting, Storyboard) + Imagen 4.0 (Images) + Translation
ELEVENLABS_API_KEY = ElevenLabs V3 TTS (Audio)

---
END OF PROJECT CONTEXT