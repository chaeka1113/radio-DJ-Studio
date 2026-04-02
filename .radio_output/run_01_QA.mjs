/**
 * run_01_QA.mjs — Hybrid QA Evaluator (Weighted Rubric Edition)
 *
 * Stage 1 (Programmatic, Hard):
 *   - 대본 분량, required_keywords, villain_required, MZ 연령
 *   - 하나라도 실패 → 즉시 Fail, Stage 2 생략
 *
 * Stage 2 (LLM, Weighted Rubric — ref_script_rubric.md):
 *   - 항목 1: 계약(Contract) 완벽 이행 [40점]
 *   - 항목 2: V3 오디오 태그 및 지문 규칙 [40점] ← CRITICAL
 *   - 항목 3: 페르소나 및 분량 [20점]
 *   - 커트라인 85점 미만 → Fail + 01_qa_feedback.json에 Actionable Feedback 기록
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

    // 1-A. 대본 분량 (최소 800자)
    const len = (ep.script || '').length;
    if (len < 800) issues.push(`분량 부족: ${len}자 (최소 800자 필요, 목표 1000자)`);

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

  console.log('✅ [QA Stage 1] 전원 통과 → Stage 2 가중치 루브릭 채점');

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 2 — 가중치 루브릭 LLM 채점 (ref_script_rubric.md 기반, 커트라인 85점)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📊 [QA Stage 2] 가중치 루브릭 채점 중 (LLM)...');

  // rubric 파일 로드
  const rubricPath = path.join(__dirname, '../.claude/skills/ref_script_rubric.md');
  const rubricText = fs.existsSync(rubricPath)
    ? fs.readFileSync(rubricPath, 'utf-8')
    : '';

  // stage2Results: id별 pass/score/deductions 초기화
  let stage2Results = stage1Results.map(r => ({
    id: r.id,
    pass: true,
    score: 100,
    deductions: [],
    actionable_feedback: [],
  }));

  if (!API_KEY) {
    console.warn('⚠️ ANTHROPIC_API_KEY 없음 — Stage 2 스킵 (Pass 처리)');
  } else {
    const client = new Anthropic({ apiKey: API_KEY });

    for (const r of stage1Results) {
      const cEp = (contract.episodes || []).find(c => c.id === r.id) || {};
      const rubricPrompt = `
당신은 テンキ爺ラジオ 대본 품질 심사관입니다.
아래 평가표(Rubric)를 바탕으로 주어진 에피소드 대본을 **항목별 배점에 따라 엄격히** 채점하라.

## 평가표 (Rubric)
${rubricText}

## 에피소드 정보
- EP ID: ${r.id}
- required_keywords: ${JSON.stringify(cEp.required_keywords || [])}
- villain_required: ${cEp.villain_required ?? 'null'}
- required_emotion_tone: ${r.reqTone ?? 'null'}
- actual_emotion_tone: ${r.actualTone ?? 'null'}
- 대본 전문:
${r.script || '(없음)'}

## 채점 지시
1. **항목 1 (계약 이행, 40점)**: required_keywords 포함 여부, 연령 설정(Stage 1에서 이미 체크됨 — 통과 시 이 세부항목은 Pass), villain_required 일치 여부를 대본 내용으로 검증. 각 세부항목 위반 시 구체적으로 감점.
2. **항목 2 (V3 오디오 태그, 40점)**: 일본어 대괄호 지문([溜息][間] 등), 일본어 괄호 행동묘사（　）, SSML(<break/>), 노이즈 의성어(ジジジ 등) 중 하나라도 발견 시 즉시 -40점. 없으면 만점.
3. **항목 3 (페르소나 및 분량, 20점)**: 대본(01_scripts)의 경우 분량(800~1000자)만 체크. 분량 미달이면 -5점, 나머지 15점은 자동 만점.

총점 = 항목1 + 항목2 + 항목3 (100점 만점)
커트라인: 85점 미만 = Fail

## 출력 형식 (JSON만 반환, 다른 텍스트 불가)
{
  "episode_id": ${r.id},
  "scores": {
    "contract_compliance": <0-40>,
    "v3_audio_tags": <0-40>,
    "persona_and_length": <0-20>
  },
  "total": <0-100>,
  "verdict": "Pass" | "Fail",
  "deductions": [
    "[항목명] -XX점 감점: 위반 내용"
  ],
  "actionable_feedback": [
    "[항목명] -XX점 감점: 위반 내용. 수정 행동: 즉각적이고 명확한 수정 지시"
  ]
}`;

      try {
        const msg = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: rubricPrompt }],
        });
        const raw = msg.content[0].text.match(/\{[\s\S]*\}/)?.[0];
        if (raw) {
          const scored = JSON.parse(raw);
          const total = scored.total ?? 100;
          const verdict = scored.verdict ?? (total >= 85 ? 'Pass' : 'Fail');
          stage2Results[r.id - 1].score = total;
          stage2Results[r.id - 1].deductions = scored.deductions || [];
          stage2Results[r.id - 1].actionable_feedback = scored.actionable_feedback || [];
          if (verdict === 'Fail' || total < 85) {
            stage2Results[r.id - 1].pass = false;
            console.log(`   ❌ EP${r.id} 루브릭 채점 Fail (${total}/100)`);
            (scored.deductions || []).forEach(d => console.log(`      ⚠️ ${d}`));
          } else {
            console.log(`   ✅ EP${r.id} 루브릭 채점 Pass (${total}/100)`);
          }
        }
      } catch (err) {
        console.warn(`   EP${r.id} 루브릭 채점 실패 → Pass 처리 (${err.message})`);
      }
    }
  }

  // ── 최종 결과 합산 ─────────────────────────────────────────────────────────
  const finalEps = stage1Results.map((r, i) => {
    const s2 = stage2Results[i];
    const rubricScore = s2.score ?? 100;
    const allIssues = [...r.issues, ...s2.deductions];
    const epPass = r.pass && s2.pass && rubricScore >= 85;
    return {
      id: r.id,
      pass: epPass,
      rubric_score: rubricScore,
      issues: allIssues,
      actionable_feedback: s2.actionable_feedback || [],
    };
  });

  const allFinalPass = finalEps.every(e => e.pass);
  const avgRubricScore = Math.round(finalEps.reduce((sum, e) => sum + e.rubric_score, 0) / finalEps.length);
  const verdict = allFinalPass ? 'Pass' : 'Fail';
  const failedFeedback = finalEps
    .filter(e => !e.pass)
    .map(e => `EP${e.id} (${e.rubric_score}/100): ${[...e.issues, ...e.actionable_feedback].join(' / ')}`);

  const qaResult = {
    verdict,
    score: avgRubricScore,
    stage: allFinalPass ? 'all' : (stage1Pass ? 2 : 1),
    episodes: finalEps,
    feedback: failedFeedback,
    summary: allFinalPass
      ? `${finalEps.length}개 에피소드 전원 Pass (평균 ${avgRubricScore}/100)`
      : `Fail: ${finalEps.filter(e => !e.pass).map(e => `EP${e.id}(${e.rubric_score}점)`).join(', ')}`,
  };

  fs.writeFileSync(path.join(__dirname, '01_qa_result.json'), JSON.stringify(qaResult, null, 2), 'utf-8');

  if (verdict === 'Pass') {
    console.log(`✅ [QA] Pass (${avgRubricScore}/100) — ${qaResult.summary}`);
    const fbPath = path.join(__dirname, '01_qa_feedback.json');
    if (fs.existsSync(fbPath)) fs.unlinkSync(fbPath);
    process.exitCode = 0;
  } else {
    console.log(`❌ [QA] Fail (${avgRubricScore}/100) — ${qaResult.summary}`);
    failedFeedback.forEach(f => console.log(`   ⚠️ ${f}`));

    // 01_qa_feedback.json — 재작업 시 Generator에 주입될 Actionable Feedback
    const feedbackPayload = {
      verdict: 'Fail',
      score: avgRubricScore,
      cutline: 85,
      feedback: failedFeedback,
      episodes: finalEps.filter(e => !e.pass).map(e => ({
        id: e.id,
        pass: false,
        rubric_score: e.rubric_score,
        issues: e.issues,
        actionable_feedback: e.actionable_feedback,
      })),
      summary: qaResult.summary,
    };
    fs.writeFileSync(path.join(__dirname, '01_qa_feedback.json'), JSON.stringify(feedbackPayload, null, 2), 'utf-8');
    console.log('   📝 01_qa_feedback.json 저장 완료 (재작업 시 프롬프트에 주입됨)');
    process.exitCode = 1;
  }
  // process.exit() 미호출 — 이벤트 루프 자연 종료 → UV_HANDLE_CLOSING 방지

})().catch(err => {
  console.error('❌ QA 내부 오류:', err.message);
  process.exitCode = 1;
});
