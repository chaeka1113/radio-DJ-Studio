import 'dotenv/config';
import express from 'express';
import { spawn } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateEpId, makePaths, ensureDirs } from './.radio_output/lib/paths.mjs';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const RADIO_DIR  = path.join(__dirname, '.radio_output');  // scripts live here (cwd)
const OUTPUT_DIR = path.join(__dirname, '.output');        // episode artifacts live here
const API_KEY    = process.env.GEMINI_API_KEY;

// Gemini 이미지 생성 클라이언트 (Nano Banana — 2.5 Flash Image)
const ai = new GoogleGenAI({ apiKey: API_KEY });

// Claude 클라이언트 (주제 선별 등 텍스트 작업)
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Active episode ID — set once per pipeline run in /api/generate-scripts */
let currentEpId = null;

/** 이미지 생성 프로세스 중복 실행 방지용 플래그 */
let imageGenRunning = false;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(OUTPUT_DIR));

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Returns path map for the active episode (creates a temp EP_ID if none is set). */
function getP() {
  if (!currentEpId) currentEpId = generateEpId();
  return makePaths(currentEpId);
}

function readJson(filename) {
  const P = getP();
  const fileMap = {
    '01_scripts.json':       P.scripts,
    '02_dj_script.json':     P.djScript,
    '04_storyboard.json':    P.storyboard,
    '05_image_results.json': P.imageResults,
  };
  const p = fileMap[filename] ?? path.join(P.base, filename);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeJson(filename, data) {
  const P = getP();
  const fileMap = {
    '01_scripts.json':   P.scripts,
    '02_dj_script.json': P.djScript,
  };
  const p = fileMap[filename] ?? path.join(P.base, filename);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function sseStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  return {
    log:  (msg)      => res.write(`data: ${JSON.stringify({ type: 'log',   message: msg })}\n\n`),
    err:  (msg)      => res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`),
    done: (code = 0) => { res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`); res.end(); },
  };
}

function runScript(sse, scriptName, args = []) {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptName, ...args], {
      cwd: RADIO_DIR,
      env: {
        ...process.env,
        EP_ID:              currentEpId,
        GEMINI_API_KEY:     API_KEY,
        ANTHROPIC_API_KEY:  process.env.ANTHROPIC_API_KEY,
        ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
      },
    });
    child.stdout.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(l => sse.log(l)));
    child.stderr.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(l => sse.err(l)));
    child.on('close', resolve);
  });
}

// ─── Pipeline APIs ───────────────────────────────────────────────────────────

// 01 대본 생성
app.post('/api/generate-scripts', async (req, res) => {
  const { topics, includeMz, includeQna, autoTrend, epNum } = req.body;
  const sse = sseStream(res);

  // epNum 유효성 검사
  const validEpNum = (epNum && !isNaN(epNum) && epNum >= 1) ? parseInt(epNum) : null;
  if (validEpNum) {
    sse.log(`📺 정식 방송 모드 — EP${validEpNum}`);
  } else {
    sse.log('🧪 테스트 모드 — 히스토리 저장 스킵');
  }

  // 새 파이프라인 실행마다 새 EP_ID 발급
  currentEpId = generateEpId();
  const P = makePaths(currentEpId);
  ensureDirs(P);
  sse.log(`📁 EP_ID: ${currentEpId}`);

  // autoTrend 모드: run_00_trend_fetcher.mjs 실행 후 stdout에서 주제 파싱
  let finalTopics = topics;
  if (autoTrend) {
    sse.log('🌐 [Trend Fetcher] RSS 트렌드 자동 수집 시작...');
    const trendTopics = await new Promise((resolve) => {
      let found = null;
      const child = spawn('node', ['run_00_trend_fetcher.mjs'], {
        cwd: RADIO_DIR,
        env: {
          ...process.env,
          EP_ID:             currentEpId,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
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
      // MZ 모드: AI로 MZ 적합 주제 1개 + 시니어 적합 주제 2개 선별
      if (includeMz && API_KEY && trendTopics.length >= 5) {
        try {
          sse.log('🎯 [MZ선별] MZ사연 적합 주제 Claude 선별 중...');
          const selResult = await claude.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 512,
            messages: [{
              role: 'user',
              content: `당신은 일본 라디오 방송 기획자입니다. 아래 수집된 일본 트렌드 주제 목록에서:\n- MZ세대(10~30대) 사연으로 활용하기 좋은 주제 1개 (연애, SNS, 취업, 학교, 청년문화, 디지털 관련)\n- 시니어(50대+) 청취자 공감 사연에 적합한 주제 2개 (건강, 노후, 가족, 추억, 지역사회 관련)\n를 선별해라. 반드시 목록에 있는 주제를 그대로 사용할 것. JSON만 반환:\n{"mz_topic": "주제", "senior_topics": ["주제1", "주제2"]}\n\n주제 목록:\n${trendTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
            }],
          });
          const rawJson = selResult.content[0].text.match(/\{[\s\S]*?\}/)?.[0];
          if (rawJson) {
            const sel = JSON.parse(rawJson);
            if (sel.mz_topic && sel.senior_topics?.length >= 2) {
              // MZ 주제를 mzEpNum 위치에 배치 (planner가 mzEpNum을 보기 전이므로 여기선 그냥 배열로 전달)
              // run_00_planner.mjs가 --mz 플래그와 함께 mzEpNum을 결정하므로
              // MZ 주제를 topics 배열의 맨 앞에 두면 planner가 EP1을 MZ로 지정할 가능성이 높음
              // → 대신 고정: MZ topic을 finalTopics[mzEpNum-1]에 넣도록 직접 배치
              // planner가 --mz 플래그 시 mzEpNum을 랜덤으로 정하므로, 우선 순서대로 넘기되
              // MZ 주제를 index 0 (EP1 후보)에 배치 — planner가 실제 EP 번호를 결정
              finalTopics = [sel.mz_topic, sel.senior_topics[0], sel.senior_topics[1]];
              sse.log(`✅ [MZ선별] MZ주제: ${sel.mz_topic}`);
              sse.log(`✅ [MZ선별] 시니어주제: ${sel.senior_topics[0]} / ${sel.senior_topics[1]}`);
            } else {
              throw new Error('선별 결과 형식 오류');
            }
          } else {
            throw new Error('JSON 파싱 실패');
          }
        } catch (e) {
          sse.log(`⚠️ [MZ선별] AI 선별 실패(${e.message}) — 상위 3개 사용`);
          finalTopics = trendTopics.slice(0, 3);
        }
      } else {
        finalTopics = trendTopics.slice(0, 3);
      }
      sse.log(`TREND_TOPICS:${finalTopics.join('|')}`);
      sse.log(`✅ [Trend Fetcher] 주제 자동 선별: ${finalTopics.join(' / ')}`);
      // 한국어 번역 (대시보드 확인용 — 실제 대본에 영향 없음)
      if (API_KEY) {
        try {
          const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `다음 일본어 주제 3개를 한국어로 간결하게 번역해라 (각 5단어 이내). JSON 배열만 반환: ["번역1", "번역2", "번역3"]\n주제1: ${finalTopics[0]}\n주제2: ${finalTopics[1]}\n주제3: ${finalTopics[2]}`,
            config: { temperature: 0.3, maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } },
          });
          const rawText = result.text.match(/\[[\s\S]*?\]/)?.[0];
          if (rawText) {
            const koTopics = JSON.parse(rawText);
            if (koTopics.length >= 3) {
              sse.log(`TREND_TOPICS_KO:${koTopics.join('|')}`);
            }
          }
        } catch (_) { /* 번역 실패는 무시 */ }
      }
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

  // MZ 플래그 로그
  sse.log('🔥 MZ 플래그: ' + (includeMz ? 'ON' : 'OFF'));

  const pipelineArgs = [...finalTopics.slice(0, 3), ...(includeMz ? ['--mz'] : []), ...(includeQna ? ['--qna'] : []), ...(validEpNum ? ['--ep', String(validEpNum)] : [])];

  // STEP 0: Planner — 에피소드 계약서 생성
  sse.log('📋 [Planner] 에피소드 완료 기준서 생성 중...');
  const plannerCode = await runScript(sse, 'run_00_planner.mjs', pipelineArgs);
  if (plannerCode !== 0) return sse.done(plannerCode);
  sse.log('✅ [Planner] ref_episode_contract.json 생성 완료');

  // STEP 1: Script + QA 자동 피드백 루프 (최대 3회)
  // 동일 EP_ID(같은 분 내 재실행) 잔류 파일 제거 — 항상 깨끗하게 시작
  if (fs.existsSync(P.qaResult))   fs.unlinkSync(P.qaResult);
  if (fs.existsSync(P.qaFeedback)) fs.unlinkSync(P.qaFeedback);

  let qaPass = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    sse.log(`✍️ [Script] 대본 생성 (시도 ${attempt}/3)...`);
    const scriptCode = await runScript(sse, 'run_01_script.mjs', pipelineArgs);
    if (scriptCode !== 0) return sse.done(scriptCode);

    // 진단: QA 직전 스크립트 파일 존재 확인
    sse.log(`[DEBUG] P.scripts = ${P.scripts}`);
    sse.log(`[DEBUG] exists = ${fs.existsSync(P.scripts)}`);

    sse.log(`🔍 [QA] 대본 검증 중 (시도 ${attempt}/3)...`);
    // 이전 시도의 stale qaResult 제거 — QA가 조기 종료해도 오래된 결과를 읽지 않도록
    if (fs.existsSync(P.qaResult)) fs.unlinkSync(P.qaResult);
    await runScript(sse, 'run_01_QA.mjs');

    if (!fs.existsSync(P.qaResult)) {
      sse.log('⚠️ QA 결과 파일 없음 — Pass 처리');
      qaPass = true;
      break;
    }
    const qaResult = JSON.parse(fs.readFileSync(P.qaResult, 'utf-8'));
    const qaScore  = typeof qaResult.score === 'number' ? qaResult.score : 100;
    const qaFailed = qaResult.verdict !== 'Pass' || qaScore < 85;

    if (!qaFailed) {
      sse.log(`✅ [QA] Pass (${qaScore}/100) — 다음 단계로 진행`);
      qaPass = true;
      break;
    } else {
      sse.log(`❌ [QA] Fail (${qaScore}/100, 커트라인 85) — ${qaResult.summary ?? ''}`);
      (qaResult.feedback || []).forEach(f => sse.log(`   ⚠️ ${f}`));
      (qaResult.episodes || [])
        .filter(e => !e.pass)
        .forEach(e => {
          (e.actionable_feedback || []).forEach(af => sse.log(`   🔧 EP${e.id}: ${af}`));
        });
      if (attempt < 3) {
        if (fs.existsSync(P.qaFeedback)) {
          sse.log(`🔄 [Loop] QA 피드백 확인 완료 → 재작업 시작 (${attempt + 1}/3)`);
        } else {
          // QA가 feedback 파일을 못 썼을 경우 fallback
          fs.writeFileSync(P.qaFeedback, JSON.stringify({
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

  // WRAPUP: QA 실패 사유를 오답 노트에 압축 기록
  sse.log('🧠 [Wrapup] 오답 노트 압축 중...');
  await runScript(sse, 'run_99_wrapup.mjs');

  sse.done(0);
});

// 02 DJ 멘트 생성
app.post('/api/generate-dj', (req, res) => {
  const { includeQna } = req.body || {};
  const sse  = sseStream(res);
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
  // visual_QA는 보조 최적화 단계 — 실패해도 파이프라인 계속 진행
  if (codeQA !== 0) sse.log('⚠️ [Visual QA] 경고 — 이미지 생성은 계속 진행');
  sse.done(0);
});

// 05 이미지 생성
app.post('/api/generate-images', (req, res) => {
  const sse = sseStream(res);

  // 이중 실행 방지: 이미 이미지 생성 중이면 차단
  if (imageGenRunning) {
    sse.log('⚠️ 이미지 생성이 이미 진행 중입니다. 완료 후 다시 시도하세요.');
    return sse.done(1);
  }

  const { force } = req.body || {};
  const P = getP();
  if (force && fs.existsSync(P.images)) {
    fs.rmSync(P.images, { recursive: true, force: true });
    fs.mkdirSync(P.images, { recursive: true });
    sse.log('🗑 기존 이미지 폴더 삭제 완료 → 전체 재생성 시작');
  }

  imageGenRunning = true;
  runScript(sse, 'run_05_images.mjs')
    .then(code => sse.done(code))
    .catch(err => { sse.err(`예외: ${err.message}`); sse.done(1); })
    .finally(() => { imageGenRunning = false; });
});

// 07 오디오 → 06 CapCut 프로젝트 빌드
app.post('/api/generate-audio-script', async (req, res) => {
  const sse = sseStream(res);

  const audioCode = await runScript(sse, 'run_07_audio.mjs');
  if (audioCode !== 0) return sse.done(audioCode);

  sse.log('🎬 [CapCut] 프로젝트 빌드 중...');
  const capcutCode = await runScript(sse, 'run_06_capcut_builder.mjs');
  if (capcutCode !== 0) {
    sse.log('⚠️ [CapCut] 빌드 실패');
    return sse.done(capcutCode);
  }
  sse.log('✅ [CapCut] 완료 — capcut/ 에 draft_content.json 저장됨');

  sse.done(0);
});

// ─── 이미지 단일 재생성 ───────────────────────────────────────────────────────
// run_05_images.mjs의 buildPrompt와 동일한 구조로 CHARACTER LOCK 적용

app.post('/api/regenerate-image', async (req, res) => {
  const { scene_id } = req.body;
  if (!scene_id) return res.status(400).json({ error: 'scene_id 필요' });

  const P = getP();

  // 스토리보드 로드
  const storyboard = (() => {
    if (!fs.existsSync(P.storyboard)) return null;
    return JSON.parse(fs.readFileSync(P.storyboard, 'utf-8'));
  })();
  if (!storyboard) return res.status(404).json({ error: '스토리보드 없음' });

  const scenes = storyboard.scenes
    ?? storyboard.episodes?.flatMap(ep => (ep.scenes || []).map(s => ({ ...s, episode_id: ep.episode_id ?? ep.id })))
    ?? [];
  const scene = scenes.find(s => s.scene_id === scene_id);
  if (!scene) return res.status(404).json({ error: `씬 ${scene_id} 없음` });

  // 캐릭터 DNA 로드 (run_05와 동일 방식)
  const DJ_DNA = 'A consistent character named Tenki-jii: a battered retro tin robot DJ with a square boxy head, cracked silver paint with rust spots and dents, single glowing amber mono-eye lens, two bent antennae on top of head each with small colored flags attached, faded red chest panel with analog dials, gauges, and blinking indicator lights, worn silver mechanical arms with visible ball-joint connections, always seated behind a vintage Showa-era wooden radio desk loaded with vinyl record stacks, old vacuum tube amplifiers, and a large retro microphone. NEVER change: square boxy head shape, amber mono-eye, rust-spotted silver body, faded red chest panel, bent antennae.';

  let mainDna = null;
  let secondaryChars = [];
  if (fs.existsSync(P.characterPrompts)) {
    const charData = JSON.parse(fs.readFileSync(P.characterPrompts, 'utf-8'));
    const epChar = (charData.characters ?? []).find(c => c.episode_id === scene.episode_id);
    if (epChar) {
      mainDna = epChar.character_seed?.trim() ?? null;
      secondaryChars = (epChar.secondary_characters ?? []);
    }
  }

  const isDJ = scene.type === 'DJ_SHOT' || scene.speaker === 'TENKI_JII';
  const dna   = isDJ ? DJ_DNA : mainDna;
  const isFlashback = scene.type === 'FLASHBACK';

  // CHARACTER LOCK 블록 구성
  function charLockBlock(seed, isFlash) {
    if (!seed) return '';
    if (isFlash) {
      return [
        '=== MAIN CHARACTER (YOUNGER VERSION — FLASHBACK) ===',
        seed,
        'FLASHBACK OVERRIDES: smooth youthful face, no wrinkles, thick dark hair, energetic posture.',
        '=== END MAIN CHARACTER ===',
      ].join('\n');
    }
    return [
      '=== MAIN CHARACTER LOCK ===',
      seed,
      'LOCK — NEVER change: face structure, hair, clothing, body proportions.',
      '=== END MAIN CHARACTER LOCK ===',
    ].join('\n');
  }

  const SCENE_TYPE_STYLE = {
    ESTABLISHING:    'Wide establishing shot, environment-focused, expansive scenery.',
    CHARACTER_SCENE: 'Medium shot framing character from waist up.',
    CLOSE_UP:        "Extreme close-up on character's face, shallow depth of field.",
    FLASHBACK:       'Soft warm sepia color grading, desaturated nostalgic tone, dreamlike soft focus.',
    DJ_SHOT:         'Medium studio shot, vintage radio desk prominent in foreground.',
  };

  const STYLE_BASE = 'Showa retro anime illustration in the style of Studio Ghibli. Warm color palette: amber, dusty rose, faded navy. Soft cinematic lighting. Masterpiece quality, highly detailed, 8k.';
  const NO_TEXT    = 'CRITICAL: Do NOT include ANY text, letters, subtitles, captions, Japanese/Chinese/Korean text, typography, or signs with readable text.';
  const GLOBAL_NEG = 'photorealistic, 3D render, realistic photograph, hyperrealistic, modern style, cyberpunk, neon colors, glossy texture, nsfw, blurry, watermark, western features, text, letters, subtitles, captions, japanese text, korean text, typography';

  const parts = [];

  const mainLock = charLockBlock(dna, isFlashback);
  if (mainLock) parts.push(mainLock, '');

  // 보조 캐릭터 감지
  const haystack = (scene.visual_prompt_en ?? '').toLowerCase();
  const matchedSec = secondaryChars.filter(sc =>
    (sc.detection_keywords ?? []).some(kw => haystack.includes(kw.toLowerCase()))
  );
  matchedSec.forEach(sc => {
    if (sc.character_seed) {
      parts.push(
        `=== SECONDARY CHARACTER: ${sc.character_name ?? sc.character_key} ===`,
        sc.character_seed,
        'LOCK — render with IDENTICAL appearance, distinct from other characters.',
        `=== END SECONDARY CHARACTER: ${sc.character_name ?? sc.character_key} ===`,
        ''
      );
    }
  });

  parts.push('=== SCENE DESCRIPTION ===');
  if (SCENE_TYPE_STYLE[scene.type]) parts.push(SCENE_TYPE_STYLE[scene.type]);
  if (scene.camera_direction)       parts.push(`Camera framing: ${scene.camera_direction}.`);
  if (scene.japanese_dialogue?.trim()) parts.push(`Emotional moment: "${scene.japanese_dialogue.trim()}"`);
  parts.push(scene.visual_prompt_en ?? '');
  parts.push('=== END SCENE ===', '');

  parts.push('=== STYLE ===', STYLE_BASE, '=== END STYLE ===', '');
  parts.push('=== FORBIDDEN ===', NO_TEXT);
  const sceneNeg = scene.negative_prompt?.trim() ?? '';
  parts.push(`Also avoid: ${sceneNeg ? `${sceneNeg}, ` : ''}${GLOBAL_NEG}`);
  parts.push('=== END FORBIDDEN ===');

  const fullPrompt = parts.join('\n');

  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ text: fullPrompt }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '16:9' },
      },
    });
    const imgParts = result.candidates?.[0]?.content?.parts ?? [];
    const imgPart  = imgParts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (!imgPart) throw new Error('이미지 데이터 없음');

    fs.mkdirSync(P.images, { recursive: true });
    fs.writeFileSync(path.join(P.images, `${scene_id}.png`), Buffer.from(imgPart.inlineData.data, 'base64'));
    res.json({ success: true, scene_id, url: `/output/${currentEpId}/images/${scene_id}.png?t=${Date.now()}` });
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
  if (!text)    return res.status(400).json({ error: 'text 필요' });
  if (!API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY 없음' });
  try {
    const result = await geminiWithRetry(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `주어진 일본어 라디오 대본을 한국어로 자연스럽게 번역해라. 번역된 텍스트만 반환해라.\n\n${text}`,
      config: { temperature: 0.3, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },
    }));
    res.json({ translated: result.text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 데이터 읽기 ─────────────────────────────────────────────────────────────

app.get('/api/current-ep', (req, res) => {
  res.json({ ep_id: currentEpId });
});

app.get('/api/data/scripts', (req, res) => {
  const d = readJson('01_scripts.json');
  d ? res.json(d) : res.status(404).json({ error: '파일 없음' });
});
app.get('/api/data/dj', (req, res) => {
  const d = readJson('02_dj_script.json');
  d ? res.json(d) : res.status(404).json({ error: '파일 없음' });
});
app.get('/api/data/audio', (req, res) => {
  const p = getP().finalTtsScript;
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
  fs.writeFileSync(getP().finalTtsScript, req.body.text, 'utf-8');
  res.json({ success: true });
});

// ─── CapCut 프로젝트 생성 ─────────────────────────────────────────────────────

app.post('/api/generate-capcut', (req, res) => {
  const sse = sseStream(res);
  runScript(sse, 'run_06_capcut_builder.mjs').then(code => sse.done(code));
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(3000, () => {
  console.log('🚀 ガラクタロボ DJ Studio → http://localhost:3000');
  console.log(`🔑 GEMINI_API_KEY: ${API_KEY ? '✅ 로드됨' : '❌ 없음'}`);
});
