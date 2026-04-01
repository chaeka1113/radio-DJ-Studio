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
  const { topics, includeMz, includeQna, autoTrend } = req.body;
  const sse = sseStream(res);

  // autoTrend 모드: run_00_trend_fetcher.mjs 실행 후 stdout에서 주제 파싱
  let finalTopics = topics;
  if (autoTrend) {
    sse.log('🌐 [Trend Fetcher] RSS 트렌드 자동 수집 시작...');
    const trendTopics = await new Promise((resolve) => {
      let found = null;
      const child = spawn('node', ['run_00_trend_fetcher.mjs'], {
        cwd: RADIO_DIR,
        env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
      });
      child.stdout.on('data', (d) => {
        const lines = d.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          if (line.startsWith('TOPICS:')) {
            found = line.replace('TOPICS:', '').split('|').map(t => t.trim()).filter(Boolean);
          } else {
            sse.log(line);
          }
        }
      });
      child.stderr.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(l => sse.err(l)));
      child.on('close', () => resolve(found));
    });

    if (trendTopics && trendTopics.length >= 3) {
      finalTopics = trendTopics.slice(0, 3);
      sse.log(`TREND_TOPICS:${finalTopics.join('|')}`);
      sse.log(`✅ [Trend Fetcher] 주제 자동 선별: ${finalTopics.join(' / ')}`);
    } else {
      // 트렌드 수집 실패 → 기존 topics로 fallback
      if (!topics || topics.filter(Boolean).length < 3) {
        sse.err('❌ 트렌드 수집 실패 & 주제 미입력 — 파이프라인 중단');
        return sse.done(1);
      }
      sse.log('⚠️ 트렌드 수집 실패 — 입력된 주제로 대체 진행');
      finalTopics = topics;
    }
  } else {
    if (!finalTopics || finalTopics.length < 3) return res.status(400).json({ error: '주제 3개 필요' });
  }

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

  const pipelineArgs = [...finalTopics.slice(0, 3), ...(includeMz ? ['--mz'] : []), ...(includeQna ? ['--qna'] : [])];

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
    const qaScore = typeof qaResult.score === 'number' ? qaResult.score : 100;
    const qaFailed = qaResult.verdict !== 'Pass' || qaScore < 85;

    if (!qaFailed) {
      sse.log(`✅ [QA] Pass (${qaScore}/100) — 다음 단계로 진행`);
      qaPass = true;
      break;
    } else {
      sse.log(`❌ [QA] Fail (${qaScore}/100, 커트라인 85) — ${qaResult.summary ?? ''}`);
      // feedback 배열 (EP별 요약)
      (qaResult.feedback || []).forEach(f => sse.log(`   ⚠️ ${f}`));
      // actionable_feedback: 신규 루브릭 채점에서 에피소드별 수정 지시 추출
      (qaResult.episodes || [])
        .filter(e => !e.pass)
        .forEach(e => {
          (e.actionable_feedback || []).forEach(af => sse.log(`   🔧 EP${e.id}: ${af}`));
        });
      if (attempt < 3) {
        // run_01_QA.mjs가 이미 01_qa_feedback.json을 올바른 형식으로 작성함.
        // 여기서 덮어쓰지 않는다 — run_01_script.mjs가 그 파일을 직접 읽어 주입.
        const fbPath = path.join(RADIO_DIR, '01_qa_feedback.json');
        if (fs.existsSync(fbPath)) {
          sse.log(`🔄 [Loop] QA 피드백 확인 완료 → 재작업 시작 (${attempt + 1}/3)`);
        } else {
          // QA가 feedback 파일을 못 썼을 경우 fallback: qaResult로 직접 생성
          fs.writeFileSync(fbPath, JSON.stringify({
            verdict: 'Fail',
            score: qaScore,
            cutline: 85,
            feedback: qaResult.feedback || [],
            episodes: (qaResult.episodes || []).filter(e => !e.pass).map(e => ({
              id: e.id,
              pass: false,
              rubric_score: e.rubric_score ?? qaScore,
              issues: e.issues || [],
              actionable_feedback: e.actionable_feedback || [],
            })),
            summary: qaResult.summary || '',
          }, null, 2));
          sse.log(`🔄 [Loop] 피드백 fallback 저장 → 재작업 시작 (${attempt + 1}/3)`);
        }
      }
    }
  }
  if (!qaPass) sse.log('⚠️ [QA] 최대 재시도 초과 — 현재 대본으로 진행합니다');

  // WRAPUP: QA 실패 사유를 오답 노트에 압축 기록 (실패/성공 무관 항상 실행)
  // 실패 사유가 없으면 wrapup 자체에서 no-op 처리
  sse.log('🧠 [Wrapup] 오답 노트 압축 중...');
  await runScript(sse, 'run_99_wrapup.mjs');
  // wrapup 실패(exit code != 0)여도 파이프라인은 계속 진행

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
  if (code04 !== 0) return sse.done(code04);
  const codeQA = await runScript(sse, 'run_04_visual_QA.mjs');
  sse.done(codeQA);
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
  const FALLBACK_NEGATIVE = 'photorealistic, 3d render, realistic, photography, highly detailed skin, cyberpunk, transformer, modern style, neon colors, glossy texture, plastic texture, abstract, moles, beauty marks, glasses, spectacles, nsfw, blurry, watermark, western features';
  const prompt = scene.visual_prompt_en + STYLE;
  const negativePrompt = scene.negative_prompt || FALLBACK_NEGATIVE;
  const body = JSON.stringify({
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: '16:9', safetyFilterLevel: 'BLOCK_ONLY_HIGH', personGeneration: 'ALLOW_ALL', negativePrompt },
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
