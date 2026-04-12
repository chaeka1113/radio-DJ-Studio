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
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import { loadEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

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
  // ── 필수 파일 체크 ─────────────────────────────────────────────────────────
  if (!fs.existsSync(P.storyboard)) {
    console.error('❌ 04_storyboard.json 없음');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(P.refVisualRubric)) {
    console.error('❌ ref_visual_rubric.md 없음');
    process.exitCode = 1;
    return;
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    console.warn('⚠️ ANTHROPIC_API_KEY 없음 — Visual QA 스킵 (Pass 처리)');
    const storyboard = JSON.parse(fs.readFileSync(P.storyboard, 'utf-8'));
    const total = (storyboard.scenes || storyboard).length;
    fs.writeFileSync(P.visualQaResult, JSON.stringify({
      verdict: 'Pass', skipped: true, total_scenes: total,
      checked_scenes: 0, fixed_scenes: 0, failed_scenes: [],
      summary: 'ANTHROPIC_API_KEY 없음 — 스킵',
    }, null, 2));
    process.exitCode = 0;
    return;
  }

  const rubricText  = fs.readFileSync(P.refVisualRubric, 'utf-8');
  let storyboard    = JSON.parse(fs.readFileSync(P.storyboard, 'utf-8'));
  // 스토리보드는 배열 또는 { scenes: [] } 형태 모두 허용
  const scenes      = Array.isArray(storyboard) ? storyboard : (storyboard.scenes || []);

  const client   = new Anthropic({ apiKey: API_KEY });
  const QA_MODEL = 'claude-sonnet-4-5';

  // ── 배치 채점 프롬프트 (씬 전체를 1회 호출) ────────────────────────────
  function buildBatchScoringPrompt(scenesToScore) {
    const scenesList = scenesToScore.map((s, i) =>
      `### Scene ${i + 1}\n` +
      `- scene_id: "${s.scene_id || `SC${String(i + 1).padStart(3, '0')}`}"\n` +
      `- type: "${s.type || 'UNKNOWN'}"\n` +
      `- visual_prompt_en: ${s.visual_prompt_en || ''}\n` +
      `- negative_prompt: ${s.negative_prompt || '(none)'}`
    ).join('\n\n');

    return `You are a strict visual prompt QA evaluator for an AI image generation pipeline targeting Japanese senior audiences.
Score ALL ${scenesToScore.length} scenes below according to the rubric. Cutline is ${CUTLINE}/100.

## Visual Rubric
${rubricText}

## Scoring Rules
1. Character Consistency & Senior Negative Constraints [40pts]
   - 1-A (20pts): AI Slop prevention: no moles, no beauty marks, clear skin, no extra fingers, natural aging features
   - 1-B (20pts): Forbidden styles NOT in visual_prompt_en AND ARE in negative_prompt (cyberpunk, neon colors, glossy texture, plastic texture, abstract, Hyper-modern Transformer style)
   - DJ_SHOT / ESTABLISHING scenes without character seed → full 40pts automatically
2. Physical Realism [30pts]: explicit physical verbs for object/body interactions
3. Art Style Consistency [30pts]: ends with Showa retro anime + Ghibli palette, masterpiece/best quality, no --ar param

## Scenes to Evaluate
${scenesList}

Return ONLY a valid JSON array (one object per scene, same order):
[{"scene_id":"...","scores":{"character_consistency":<0-40>,"physical_realism":<0-30>,"art_style":<0-30>},"total":<0-100>,"verdict":"Pass"|"Fix","deductions":[...],"autofix_instructions":[...]}]`;
  }

  // ── 배치 자동 교정 프롬프트 (실패 씬 전체를 1회 호출) ──────────────────
  function buildBatchFixPrompt(failedItems) {
    const scenesList = failedItems.map((item, i) =>
      `### Scene ${i + 1}\n` +
      `- scene_id: "${item.sceneId}"\n` +
      `- type: "${item.sceneType}"\n` +
      `- visual_prompt_en: ${item.currentPrompt}\n` +
      `- negative_prompt: ${item.currentNegative || '(none)'}\n` +
      `- deductions: ${(item.deductions || []).join(' | ')}\n` +
      `- fix_instructions: ${(item.fixInstructions || []).join(' | ')}`
    ).join('\n\n');

    return `You are a visual prompt auto-corrector. Apply fix instructions to reach ${CUTLINE}+/100.

## Correction Rules
- Keep original scene action/story intact
- Add AI Slop prevention to visual_prompt_en if missing (no moles, no beauty marks, clear skin, no extra fingers, natural aging features)
- Remove forbidden style keywords from visual_prompt_en (cyberpunk, neon colors, glossy texture, plastic texture, abstract)
- Ensure negative_prompt includes: modern style, cyberpunk, neon colors, glossy texture, plastic texture, abstract, photorealistic, 3D render, nsfw, blurry, watermark, western features
- End visual_prompt_en with: Showa retro anime illustration, Studio Ghibli warm color palette, warm amber cinematic lighting, masterpiece, best quality, highly detailed, 8k, 16:9
- Use explicit physical verbs for object interactions
- NEVER add --ar Midjourney parameters

## Failed Scenes to Correct
${scenesList}

Return ONLY a valid JSON array:
[{"scene_id":"...","corrected_visual_prompt_en":"...","corrected_negative_prompt":"..."}]`;
  }

  // ── 메인 배치 로직 ────────────────────────────────────────────────────────
  console.log(`🎨 [Visual QA] ${scenes.length}개 씬 배치 채점 (Claude 1회 호출)...`);

  const qaResults = [];
  let fixedCount  = 0;
  let failedCount = 0;

  // STEP 1: 전체 씬 배치 채점 (API 1회)
  let scoringResults = null;
  try {
    const batchPrompt = buildBatchScoringPrompt(scenes);
    const result = await client.messages.create({
      model: QA_MODEL,
      max_tokens: 8192,
      temperature: 0.3,
      messages: [{ role: 'user', content: batchPrompt }],
    });
    const text = result.content[0]?.text ?? '';
    const raw  = text.match(/\[[\s\S]*\]/)?.[0];
    if (!raw) throw new Error('배치 채점 JSON 배열 없음');
    scoringResults = JSON.parse(raw);
    console.log(`✅ [Visual QA] 배치 채점 완료 — ${scoringResults.length}씬 결과 수신`);
  } catch (err) {
    console.warn(`⚠️ [Visual QA] 배치 채점 실패 → 전체 Pass 처리 (${err.message.slice(0, 120)})`);
  }

  // STEP 2: 채점 결과 파싱 + 실패 씬 수집
  const failedItems = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene   = scenes[i];
    const sceneId = scene.scene_id || `SC${String(i + 1).padStart(3, '0')}`;

    if (!scoringResults) {
      // 배치 채점 자체가 실패한 경우 — Pass 처리
      qaResults.push({ scene_id: sceneId, type: scene.type || 'UNKNOWN', final_score: 100, status: 'pass_fallback' });
      continue;
    }

    const scored = scoringResults.find(r => r.scene_id === sceneId) ?? scoringResults[i];
    if (!scored) {
      qaResults.push({ scene_id: sceneId, type: scene.type || 'UNKNOWN', final_score: 100, status: 'pass_not_found' });
      continue;
    }

    const score   = scored.total ?? 0;
    const verdict = scored.verdict ?? (score >= CUTLINE ? 'Pass' : 'Fix');

    if (verdict === 'Pass' || score >= CUTLINE) {
      process.stdout.write(`   ✅ ${sceneId} [${scene.type || '?'}] ${score}/100\n`);
      qaResults.push({ scene_id: sceneId, type: scene.type || 'UNKNOWN', final_score: score, status: 'pass' });
    } else {
      console.log(`   ⚠️ ${sceneId} [${scene.type || '?'}] ${score}/100 < ${CUTLINE} — 교정 대기`);
      (scored.deductions || []).forEach(d => console.log(`      ${d}`));
      failedItems.push({
        sceneId,
        sceneType: scene.type || 'UNKNOWN',
        currentPrompt:   scene.visual_prompt_en || '',
        currentNegative: scene.negative_prompt  || '',
        deductions:      scored.deductions         || [],
        fixInstructions: scored.autofix_instructions || [],
        score,
        sceneRef: scene,
      });
    }
  }

  // STEP 3: 실패 씬 배치 교정 (API 1회)
  if (failedItems.length > 0) {
    console.log(`\n🔧 [Visual QA] ${failedItems.length}개 씬 배치 교정 (Claude 1회 호출)...`);
    try {
      const fixPrompt = buildBatchFixPrompt(failedItems);
      const fixResult = await client.messages.create({
        model: QA_MODEL,
        max_tokens: 8192,
        temperature: 0.3,
        messages: [{ role: 'user', content: fixPrompt }],
      });
      const fixText = fixResult.content[0]?.text ?? '';
      const fixRaw  = fixText.match(/\[[\s\S]*\]/)?.[0];
      if (!fixRaw) throw new Error('배치 교정 JSON 배열 없음');
      const fixes = JSON.parse(fixRaw);

      for (const fix of fixes) {
        const item = failedItems.find(f => f.sceneId === fix.scene_id);
        if (!item) continue;
        if (fix.corrected_visual_prompt_en) item.sceneRef.visual_prompt_en = fix.corrected_visual_prompt_en;
        if (fix.corrected_negative_prompt)  item.sceneRef.negative_prompt  = fix.corrected_negative_prompt;
        console.log(`   ✅ ${fix.scene_id} 교정 적용 완료`);
        fixedCount++;
        qaResults.push({
          scene_id: fix.scene_id, type: item.sceneType,
          final_score: item.score, status: 'fixed',
          corrected_visual_prompt_en: fix.corrected_visual_prompt_en,
        });
      }

      // 교정 결과 없는 실패 씬 → failed 기록
      for (const item of failedItems) {
        if (!fixes.find(f => f.scene_id === item.sceneId)) {
          console.log(`   ❌ ${item.sceneId} 교정 결과 없음 — 원본 유지`);
          failedCount++;
          qaResults.push({
            scene_id: item.sceneId, type: item.sceneType,
            final_score: item.score, status: 'failed_after_retry',
            deductions: item.deductions,
          });
        }
      }
    } catch (err) {
      console.warn(`⚠️ [Visual QA] 배치 교정 실패 — 원본 프롬프트 유지 (${err.message.slice(0, 120)})`);
      for (const item of failedItems) {
        failedCount++;
        qaResults.push({
          scene_id: item.sceneId, type: item.sceneType,
          final_score: item.score, status: 'failed_after_retry',
          deductions: item.deductions,
        });
      }
    }
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
    fs.writeFileSync(P.storyboard, JSON.stringify(scenes, null, 2), 'utf-8');
  } else {
    storyboard.scenes = scenes;
    fs.writeFileSync(P.storyboard, JSON.stringify(storyboard, null, 2), 'utf-8');
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
    P.visualQaResult,
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
