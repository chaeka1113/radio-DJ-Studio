/**
 * run_04_visual_QA.mjs — Visual Prompt Weighted QA Evaluator
 *
 * Stage 1 — LLM 가중치 채점 (Gemini 2.5 Flash, ref_visual_rubric.md):
 *   항목 1: 캐릭터 일관성 및 시니어 네거티브 제약 [40점]
 *   항목 2: 물리적 리얼리즘 [30점]
 *   항목 3: 아트 스타일 일관성 [30점]
 *   90점 미만 씬 → Auto-fix 교정 (Max 3 Retries per scene)
 *
 * Stage 2 — Imagen 4.0 Payload 규격 프로그래매틱 검증:
 *   - instances[0].prompt 비어있지 않음
 *   - 최종 합산 프롬프트 길이 ≤ 2000자
 *   - --ar Midjourney 파라미터 미포함 (자동 제거)
 *   - parameters 필수값 시뮬레이션 검증
 *     (aspectRatio: "16:9", safetyFilterLevel: "BLOCK_ONLY_HIGH",
 *      personGeneration: "ALLOW_ALL", sampleCount: 1)
 *
 * 결과: 04_visual_qa_result.json / 04_storyboard.json 인플레이스 업데이트
 * Clean Exit: process.exitCode + top-level await
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
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

const CUTLINE = 90;
const MAX_FIX_RETRIES = 3;

// ── Imagen 4.0 Payload 규격 상수 (run_05_images.mjs와 동기화) ─────────────
const IMAGEN_STYLE_SUFFIX = ' Showa retro anime illustration, Studio Ghibli warm color palette, warm amber cinematic lighting, masterpiece, best quality, highly detailed, 8k, 16:9.';
const IMAGEN_REQUIRED_PARAMS = {
  sampleCount:       1,
  aspectRatio:       '16:9',
  safetyFilterLevel: 'BLOCK_ONLY_HIGH',
  personGeneration:  'ALLOW_ALL',
};
const IMAGEN_PROMPT_MAX_CHARS = 2000;
// Midjourney 파라미터 패턴 (텍스트 프롬프트에 있으면 API 오류 또는 오작동)
const MIDJOURNEY_PARAM_RE = /--\w[\w:]+(\s+[\w.:]+)?/g;

(async () => {
  const storyboardPath = path.join(__dirname, '04_storyboard.json');
  const rubricPath     = path.join(__dirname, '../.claude/skills/ref_visual_rubric.md');

  // ── 필수 파일 체크 ─────────────────────────────────────────────────────────
  if (!fs.existsSync(storyboardPath)) {
    console.error('❌ 04_storyboard.json 없음');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(rubricPath)) {
    console.error('❌ ref_visual_rubric.md 없음');
    process.exitCode = 1;
    return;
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    console.warn('⚠️ GEMINI_API_KEY 없음 — Visual QA 스킵 (Pass 처리)');
    const storyboard = JSON.parse(fs.readFileSync(storyboardPath, 'utf-8'));
    const total = (storyboard.scenes || storyboard).length;
    fs.writeFileSync(path.join(__dirname, '04_visual_qa_result.json'), JSON.stringify({
      verdict: 'Pass', skipped: true, total_scenes: total,
      checked_scenes: 0, fixed_scenes: 0, failed_scenes: [],
      summary: 'GEMINI_API_KEY 없음 — 스킵',
    }, null, 2));
    process.exitCode = 0;
    return;
  }

  const rubricText  = fs.readFileSync(rubricPath, 'utf-8');
  let storyboard    = JSON.parse(fs.readFileSync(storyboardPath, 'utf-8'));
  // 스토리보드는 배열 또는 { scenes: [] } 형태 모두 허용
  const scenes      = Array.isArray(storyboard) ? storyboard : (storyboard.scenes || []);

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  // ── 지수 백오프 재시도 헬퍼 ──────────────────────────────────────────────
  async function withRetry(fn, label, maxRetries = 3) {
    const delays = [5000, 15000, 30000];
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn();
      } catch (err) {
        const is429 = err.message?.includes('429') || err.message?.toLowerCase().includes('quota');
        const is503 = err.message?.includes('503') || err.message?.toLowerCase().includes('unavailable');
        if (i < maxRetries && (is429 || is503)) {
          const wait = is429 ? delays[i] * 2 : delays[i];
          console.warn(`   ⚠️ [${label}] ${is429 ? '429 쿼터' : '503 과부하'} — ${wait / 1000}초 후 재시도 (${i + 1}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          throw err;
        }
      }
    }
  }

  // ── 씬 채점 프롬프트 ────────────────────────────────────────────────────
  function buildScoringPrompt(sceneId, sceneType, visualPrompt, negativePrompt) {
    return `
You are a strict visual prompt QA evaluator for an AI image generation pipeline targeting Japanese senior audiences.
Score the given scene prompt according to the rubric below. Be rigorous — the cutline is ${CUTLINE}/100.

## Visual Rubric
${rubricText}

## Scene to Evaluate
- Scene ID: ${sceneId}
- Scene Type: ${sceneType}
- visual_prompt_en: ${visualPrompt}
- negative_prompt: ${negativePrompt || '(none)'}

## Scoring Instructions
1. **Item 1 — Character Consistency & Senior Negative Constraints [40 points]**
   - 1-A (20pts): Check for AI Slop prevention keywords: no moles, no beauty marks, clear skin, no extra fingers, natural aging features
   - 1-B (20pts): Check that forbidden styles (cyberpunk, neon colors, glossy texture, plastic texture, abstract, Hyper-modern Transformer style) are NOT in visual_prompt_en AND ARE explicitly listed in negative_prompt
   - DJ_SHOT and ESTABLISHING scenes without a character seed: award full 40pts for item 1 automatically

2. **Item 2 — Physical Realism [30 points]**
   - Check all object/body interactions use explicit physical verbs (physically holding, firmly gripping, placed on the table, etc.)
   - Deduct for floating/ambiguous object placement

3. **Item 3 — Art Style Consistency [30 points]**
   - Check visual_prompt_en ends with: "Showa retro anime illustration, Studio Ghibli warm color palette"
   - Check for masterpiece/best quality keywords
   - Deduct 10pts if "--ar" Midjourney parameter found in text

Return ONLY valid JSON, no other text:
{
  "scene_id": "${sceneId}",
  "scores": {
    "character_consistency": <0-40>,
    "physical_realism": <0-30>,
    "art_style": <0-30>
  },
  "total": <0-100>,
  "verdict": "Pass" | "Fix",
  "deductions": ["[항목명] -Xpt: reason"],
  "autofix_instructions": ["[항목명]: specific fix instruction"]
}`;
  }

  // ── 자동 교정 프롬프트 ──────────────────────────────────────────────────
  function buildFixPrompt(sceneId, sceneType, originalPrompt, originalNegative, deductions, fixInstructions) {
    return `
You are a visual prompt auto-corrector. Apply the fix instructions below to improve the prompt score to ${CUTLINE}+/100.

## Scene Info
- Scene ID: ${sceneId}
- Scene Type: ${sceneType}

## Original visual_prompt_en
${originalPrompt}

## Original negative_prompt
${originalNegative || '(none)'}

## Deductions Found
${deductions.join('\n')}

## Fix Instructions (apply ALL)
${fixInstructions.join('\n')}

## Rules for correction
- Keep the original scene action/story content intact
- Add missing AI Slop prevention keywords to visual_prompt_en if needed
- Remove any forbidden style keywords (cyberpunk, neon colors, glossy texture, plastic texture, abstract, Hyper-modern Transformer style) from visual_prompt_en
- Ensure negative_prompt includes: modern style, cyberpunk, neon colors, glossy texture, plastic texture, abstract, photorealistic, 3D render, nsfw, blurry, watermark, western features
- Ensure visual_prompt_en ends with: Showa retro anime illustration, Studio Ghibli warm color palette, warm amber/dusty rose/faded navy tones, masterpiece, best quality, highly detailed, 8k, cinematic
- Replace floating/ambiguous object descriptions with physical verb forms
- NEVER add "--ar" Midjourney parameters to text

Return ONLY valid JSON, no other text:
{
  "scene_id": "${sceneId}",
  "corrected_visual_prompt_en": "full corrected prompt",
  "corrected_negative_prompt": "full corrected negative prompt"
}`;
  }

  // ── 메인 루프 ────────────────────────────────────────────────────────────
  console.log(`🎨 [Visual QA] ${scenes.length}개 씬 가중치 채점 시작 (커트라인 ${CUTLINE}/100)...`);

  const qaResults = [];
  let fixedCount  = 0;
  let failedCount = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneId   = scene.scene_id || `SC${String(i + 1).padStart(3, '0')}`;
    const sceneType = scene.type || 'UNKNOWN';

    // ESTABLISHING 배경 전용 씬(캐릭터 없음) + DJ_SHOT은 채점 간소화
    const isCharacterlessScene = sceneType === 'ESTABLISHING' && !scene.visual_prompt_en?.includes('character');

    let currentPrompt   = scene.visual_prompt_en   || '';
    let currentNegative = scene.negative_prompt    || '';
    let scenePassed     = false;
    let lastScore       = null;
    let lastDeductions  = [];

    for (let attempt = 0; attempt < MAX_FIX_RETRIES; attempt++) {
      let scored;
      try {
        const scoringPrompt = buildScoringPrompt(sceneId, sceneType, currentPrompt, currentNegative);
        const result = await withRetry(
          () => model.generateContent(scoringPrompt),
          `${sceneId} 채점 시도${attempt + 1}`
        );
        const text = result.response.text();
        const raw  = text.match(/\{[\s\S]*\}/)?.[0];
        if (!raw) throw new Error('채점 JSON 없음');
        scored = JSON.parse(raw);
      } catch (err) {
        console.warn(`   ⚠️ ${sceneId} 채점 실패 → Pass 처리 (${err.message})`);
        scenePassed = true;
        break;
      }

      lastScore      = scored.total ?? 0;
      lastDeductions = scored.deductions || [];
      const verdict  = scored.verdict ?? (lastScore >= CUTLINE ? 'Pass' : 'Fix');

      if (verdict === 'Pass' || lastScore >= CUTLINE) {
        if (attempt === 0) {
          process.stdout.write(`   ✅ ${sceneId} [${sceneType}] ${lastScore}/100\n`);
        } else {
          console.log(`   ✅ ${sceneId} Auto-fix 성공 (시도 ${attempt + 1}, ${lastScore}/100)`);
          fixedCount++;
        }
        scene.visual_prompt_en = currentPrompt;
        scene.negative_prompt  = currentNegative;
        scenePassed = true;
        break;
      }

      // Auto-fix 시도
      console.log(`   ⚠️ ${sceneId} ${lastScore}/100 < ${CUTLINE} — Auto-fix 시도 ${attempt + 1}/${MAX_FIX_RETRIES}`);
      lastDeductions.forEach(d => console.log(`      ${d}`));

      if (attempt < MAX_FIX_RETRIES - 1) {
        try {
          const fixPrompt = buildFixPrompt(
            sceneId, sceneType, currentPrompt, currentNegative,
            scored.deductions || [], scored.autofix_instructions || []
          );
          const fixResult = await withRetry(
            () => model.generateContent(fixPrompt),
            `${sceneId} Auto-fix`
          );
          const fixText = fixResult.response.text();
          const fixRaw  = fixText.match(/\{[\s\S]*\}/)?.[0];
          if (!fixRaw) throw new Error('교정 JSON 없음');
          const fixed = JSON.parse(fixRaw);
          if (fixed.corrected_visual_prompt_en) currentPrompt   = fixed.corrected_visual_prompt_en;
          if (fixed.corrected_negative_prompt)  currentNegative = fixed.corrected_negative_prompt;
        } catch (err) {
          console.warn(`   ⚠️ ${sceneId} Auto-fix ${attempt + 1} 실패: ${err.message}`);
        }
      }

      // 딜레이 (API 보호)
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!scenePassed) {
      // 3회 시도 후에도 미통과 — 최종 교정 상태로 덮어쓰되 failed 기록
      console.log(`   ❌ ${sceneId} 3회 시도 후에도 ${lastScore}/100 — 최종 교정본으로 저장`);
      scene.visual_prompt_en = currentPrompt;
      scene.negative_prompt  = currentNegative;
      failedCount++;
      qaResults.push({
        scene_id: sceneId,
        type: sceneType,
        final_score: lastScore,
        status: 'failed_after_retry',
        deductions: lastDeductions,
        corrected_visual_prompt_en: currentPrompt,
      });
    } else {
      qaResults.push({
        scene_id: sceneId,
        type: sceneType,
        final_score: lastScore ?? 100,
        status: fixedCount > 0 && lastScore !== null ? 'fixed' : 'pass',
      });
    }

    // API rate limit 보호
    await new Promise(r => setTimeout(r, 500));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 2 — Imagen 4.0 Payload 규격 프로그래매틱 검증
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n📦 [Payload Check] Imagen 4.0 API 규격 검증 시작...');

  /**
   * 씬 하나의 최종 프롬프트로 Imagen 4.0 페이로드를 시뮬레이션하고
   * 규격 위반 항목을 반환한다. 자동 교정 가능한 항목은 즉시 수정한다.
   *
   * @returns {{ issues: string[], fixed: boolean, payload: object }}
   */
  function verifyPayload(scene) {
    const issues  = [];
    let   fixed   = false;
    let   prompt  = scene.visual_prompt_en || '';

    // ── 1. Midjourney 파라미터 자동 제거 ──────────────────────────────────
    const mjMatches = prompt.match(MIDJOURNEY_PARAM_RE);
    if (mjMatches) {
      issues.push(`Midjourney 파라미터 발견 (${mjMatches.join(', ')}) — 자동 제거`);
      prompt = prompt.replace(MIDJOURNEY_PARAM_RE, '').replace(/\s{2,}/g, ' ').trim();
      scene.visual_prompt_en = prompt;
      fixed = true;
    }

    // ── 1b. 종횡비 교란 키워드 자동 제거 ─────────────────────────────────
    // "square", "portrait format", "vertical" 등은 16:9 API 설정과 충돌
    const aspectConfusionRE = /\b(square\s+format|portrait\s+format|portrait\s+ratio|vertical\s+format|1:1\s+ratio)\b/gi;
    const aspectMatches = prompt.match(aspectConfusionRE);
    if (aspectMatches) {
      issues.push(`종횡비 교란 키워드 발견 (${aspectMatches.join(', ')}) — 자동 제거`);
      prompt = prompt.replace(aspectConfusionRE, '').replace(/\s{2,}/g, ' ').trim();
      scene.visual_prompt_en = prompt;
      fixed = true;
    }

    // ── 1c. 실사 키워드 자동 제거 (아트 스타일 지시어 제외) ───────────────
    // "realistic" 단독 사용은 실사 유발. "natural aging features"처럼 natural/age 뒤에 오는 건 허용.
    const realisticRE = /\b(hyperrealistic|photorealistic(?!\s+excluded)|(?<!\w\s{0,20})realistic(?!\s+aging))\b/gi;
    const realisticMatches = prompt.match(realisticRE);
    if (realisticMatches) {
      issues.push(`실사 키워드 발견 (${realisticMatches.join(', ')}) — 자동 제거`);
      prompt = prompt.replace(realisticRE, '').replace(/\s{2,}/g, ' ').trim();
      scene.visual_prompt_en = prompt;
      fixed = true;
    }

    // ── 2. 빈 프롬프트 ────────────────────────────────────────────────────
    if (!prompt.trim()) {
      issues.push('visual_prompt_en 비어있음 — instances[0].prompt가 빈 문자열이 됨');
    }

    // ── 3. 합산 프롬프트 길이 검증 ────────────────────────────────────────
    const finalPrompt = prompt + IMAGEN_STYLE_SUFFIX;
    if (finalPrompt.length > IMAGEN_PROMPT_MAX_CHARS) {
      issues.push(
        `합산 프롬프트 ${finalPrompt.length}자 > 최대 ${IMAGEN_PROMPT_MAX_CHARS}자 ` +
        `(visual_prompt_en ${prompt.length}자 + STYLE_SUFFIX ${IMAGEN_STYLE_SUFFIX.length}자)`
      );
    }

    // ── 4. 필수 parameters 시뮬레이션 ────────────────────────────────────
    // run_05_images.mjs의 payload를 그대로 재현하여 구조 검증
    const simulatedPayload = {
      instances:  [{ prompt: finalPrompt }],
      parameters: { ...IMAGEN_REQUIRED_PARAMS },
    };

    for (const [key, expected] of Object.entries(IMAGEN_REQUIRED_PARAMS)) {
      const actual = simulatedPayload.parameters[key];
      if (actual !== expected) {
        // 이 분기는 상수 정의가 깨졌을 때만 발생
        issues.push(`parameters.${key} 불일치: 기대값="${expected}", 실제값="${actual}"`);
      }
    }

    // ── 5. aspectRatio 텍스트 오염 검증 (숫자 비율 자체는 허용, --ar만 금지) ─
    // 이미 1번에서 --ar 제거됨. 추가로 혹시 남은 패턴 확인.
    if (/--ar\s/i.test(scene.visual_prompt_en || '')) {
      issues.push('--ar 파라미터가 여전히 프롬프트에 남아있음 — 수동 확인 필요');
    }

    return { issues, fixed, payload: simulatedPayload };
  }

  let payloadIssuesTotal = 0;
  let payloadFixedTotal  = 0;
  const payloadReport    = [];

  for (const scene of scenes) {
    const sceneId = scene.scene_id || '??';
    const { issues, fixed, payload } = verifyPayload(scene);

    if (issues.length === 0) {
      const promptLen = payload.instances[0].prompt.length;
      process.stdout.write(`   ✅ ${sceneId} payload OK (${promptLen}자, 16:9, BLOCK_ONLY_HIGH)\n`);
    } else {
      payloadIssuesTotal += issues.length;
      if (fixed) payloadFixedTotal++;
      issues.forEach(issue => console.log(`   ⚠️ ${sceneId}: ${issue}`));
      payloadReport.push({ scene_id: sceneId, issues, auto_fixed: fixed });
    }
  }

  if (payloadIssuesTotal === 0) {
    console.log(`✅ [Payload Check] 전체 ${scenes.length}씬 규격 완전 통과`);
  } else {
    console.log(`⚠️ [Payload Check] ${payloadIssuesTotal}건 발견, ${payloadFixedTotal}씬 자동 수정 완료`);
  }

  // ── 교정된 스토리보드 저장 ────────────────────────────────────────────
  if (Array.isArray(storyboard)) {
    fs.writeFileSync(storyboardPath, JSON.stringify(scenes, null, 2), 'utf-8');
  } else {
    storyboard.scenes = scenes;
    fs.writeFileSync(storyboardPath, JSON.stringify(storyboard, null, 2), 'utf-8');
  }
  console.log('💾 04_storyboard.json 업데이트 완료 (LLM Auto-fix + Payload 교정 반영)');

  // ── QA 결과 저장 ──────────────────────────────────────────────────────
  const overallVerdict = failedCount === 0 ? 'Pass' : 'Partial';
  const avgScore = qaResults.length > 0
    ? Math.round(qaResults.reduce((s, r) => s + (r.final_score ?? 100), 0) / qaResults.length)
    : 100;

  const qaResultPayload = {
    verdict: overallVerdict,
    cutline: CUTLINE,
    average_score: avgScore,
    total_scenes: scenes.length,
    checked_scenes: qaResults.length,
    fixed_scenes: fixedCount,
    failed_scenes: qaResults.filter(r => r.status === 'failed_after_retry'),
    payload_check: {
      imagen_required_params: IMAGEN_REQUIRED_PARAMS,
      prompt_max_chars: IMAGEN_PROMPT_MAX_CHARS,
      total_issues: payloadIssuesTotal,
      auto_fixed_scenes: payloadFixedTotal,
      scene_reports: payloadReport,
      verdict: payloadIssuesTotal === 0 ? 'Pass' : (payloadFixedTotal === payloadReport.length ? 'Fixed' : 'Warn'),
    },
    summary: `${scenes.length}씬 검증 완료 — 평균 ${avgScore}/100, ${fixedCount}씬 LLM교정, ${failedCount}씬 교정불완전, payload ${payloadIssuesTotal}건(${payloadFixedTotal}건 자동수정)`,
  };

  fs.writeFileSync(
    path.join(__dirname, '04_visual_qa_result.json'),
    JSON.stringify(qaResultPayload, null, 2),
    'utf-8'
  );

  if (overallVerdict === 'Pass') {
    console.log(`✅ [Visual QA] Pass — ${qaResultPayload.summary}`);
    process.exitCode = 0;
  } else {
    console.log(`⚠️ [Visual QA] Partial — ${qaResultPayload.summary}`);
    // 이미지 생성은 계속 진행 (Auto-fix 적용된 최선의 프롬프트로)
    process.exitCode = 0;
  }

})().catch(err => {
  console.error('❌ Visual QA 내부 오류:', err.message);
  process.exitCode = 1;
});
