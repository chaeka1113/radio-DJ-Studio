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
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

// ── IIFE로 감싸서 early return이 가능하게 → 자연 종료 보장 ──────────────────
(async () => {

  const API_KEY = process.env.ANTHROPIC_API_KEY;

  // ── 필수 파일 체크 ─────────────────────────────────────────────────────────
  if (!fs.existsSync(P.scripts)) {
    console.error('❌ 01_scripts.json 없음');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(P.epContract)) {
    console.warn('⚠️ ref_episode_contract.json 없음 — QA 스킵 (Pass 처리)');
    const r = { verdict: 'Pass', score: 100, skipped: true, feedback: [], episodes: [], summary: '계약서 없음 — 스킵' };
    fs.writeFileSync(P.qaResult, JSON.stringify(r, null, 2));
    process.exitCode = 0;
    return;
  }

  const scripts  = JSON.parse(fs.readFileSync(P.scripts,    'utf-8'));
  const contract = JSON.parse(fs.readFileSync(P.epContract, 'utf-8'));

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
    fs.writeFileSync(P.qaResult, JSON.stringify(result, null, 2), 'utf-8');
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
  const rubricPath = P.refScriptRubric;
  const rubricText = fs.existsSync(rubricPath)
    ? fs.readFileSync(rubricPath, 'utf-8')
    : '';

  // 일본 실데이터 로드 (수치 사실성 검증용)
  const japanFactsText = fs.existsSync(P.refJapanFacts)
    ? fs.readFileSync(P.refJapanFacts, 'utf-8')
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
${japanFactsText ? `
## 수치 검증 기준 데이터 (ref_japan_facts.md)
항목 3의 수치 정확성 채점 시 아래 실데이터와 대조하라.
대본에 등장하는 가격·연금액·시급 등이 아래 범위를 크게 벗어나면 감점.

${japanFactsText}
` : ''}
## 에피소드 정보
- EP ID: ${r.id}
- required_keywords: ${JSON.stringify(cEp.required_keywords || [])}
- villain_required: ${cEp.villain_required ?? 'null'}
- required_emotion_tone: ${r.reqTone ?? 'null'}
- actual_emotion_tone: ${r.actualTone ?? 'null'}
- 대본 전문:
${r.script || '(없음)'}

## 채점 지시
1. **항목 1 (계약 이행, 25점)**: required_keywords 포함 여부(15점), 연령 설정(5점), villain_required 일치(5점).
   - 키워드: 대본 서사에 자연스럽게 녹아 있는지 확인. 단순 삽입도 인정하되, 전혀 없으면 -15점.
2. **항목 2 (V3 오디오 태그, 35점)**: 일본어 대괄호 지문([溜息][間] 등), 일본어 괄호 행동묘사（　）, SSML(<break/>), 노이즈 의성어(ジジジ 등) 중 하나라도 발견 시 즉시 -35점.
   - ⚠️ 추가: script 필드(사연자 편지)에 영문 Audio Tag([sighs] 등)도 금지 → 발견 시 -35점.
   - 영문 Audio Tag는 DJ 멘트 필드에서만 허용.
3. **항목 3 (서사 사실성 및 수치 정확성, 25점)**:
   - 구체적 지명/장소(도도부현·시구정촌·店名) 1개 이상: 5점 (없으면 -5점)
   - 수치의 현실성(위 ref_japan_facts.md 기준): 10점 (범위 크게 벗어나면 -5〜10점)
   - 실제 대화 인용(「」포함 직접 인용) 1회 이상: 5점 (없으면 -5점)
   - テンキ爺 반응 후크(독설/공감/설 치는 계기) 1개 이상: 5점 (없으면 -5점)
4. **항목 4 (분량, 15점)**: script 필드 800〜1000자. 미달 -10점, 초과 -5점.

총점 = 항목1(25) + 항목2(35) + 항목3(25) + 항목4(15) = 100점 만점
커트라인: 85점 미만 = Fail

## 출력 형식 (JSON만 반환, 다른 텍스트 불가)
{
  "episode_id": ${r.id},
  "scores": {
    "contract_compliance": <0-25>,
    "v3_audio_tags": <0-35>,
    "narrative_realism": <0-25>,
    "length": <0-15>
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
        let scored = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const msg = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [{ role: 'user', content: rubricPrompt }],
          });
          const raw = msg.content[0].text.match(/\{[\s\S]*\}/)?.[0];
          if (!raw) {
            console.warn(`   EP${r.id} 루브릭 채점 시도 ${attempt}/3: JSON 블록 없음`);
            continue;
          }
          try {
            scored = JSON.parse(raw);
            break;
          } catch (parseErr) {
            console.warn(`   EP${r.id} 루브릭 채점 시도 ${attempt}/3: JSON 파싱 실패 (${parseErr.message})`);
          }
        }
        if (scored) {
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
        } else {
          stage2Results[r.id - 1].pass = false;
          stage2Results[r.id - 1].score = 0;
          stage2Results[r.id - 1].deductions = ['루브릭 채점 3회 모두 실패 → 안전을 위해 Fail 처리'];
          console.warn(`   ❌ EP${r.id} 루브릭 채점 3회 실패 → Fail 처리`);
        }
      } catch (err) {
        stage2Results[r.id - 1].pass = false;
        stage2Results[r.id - 1].score = 0;
        stage2Results[r.id - 1].deductions = [`루브릭 API 오류: ${err.message}`];
        console.warn(`   ❌ EP${r.id} 루브릭 채점 API 오류 → Fail 처리 (${err.message})`);
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

  fs.writeFileSync(P.qaResult, JSON.stringify(qaResult, null, 2), 'utf-8');

  if (verdict === 'Pass') {
    console.log(`✅ [QA] Pass (${avgRubricScore}/100) — ${qaResult.summary}`);
    const fbPath = P.qaFeedback;
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
    fs.writeFileSync(P.qaFeedback, JSON.stringify(feedbackPayload, null, 2), 'utf-8');
    console.log('   📝 01_qa_feedback.json 저장 완료 (재작업 시 프롬프트에 주입됨)');
    process.exitCode = 1;
  }
  // process.exit() 미호출 — 이벤트 루프 자연 종료 → UV_HANDLE_CLOSING 방지

})().catch(err => {
  console.error('❌ QA 내부 오류:', err.message);
  process.exitCode = 1;
});
