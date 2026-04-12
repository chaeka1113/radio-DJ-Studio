/**
 * run_99_wrapup.mjs — Persistent Learnings Loop (오답 노트 압축기)
 *
 * 1. QA 실패 사유를 01_qa_feedback.json / 01_qa_result.json 에서 추출
 * 2. 기존 ref_learnings.md와 병합
 * 3. Gemini 2.5 Flash로 중복 제거 + 압축 → 최대 10개 bullet 유지
 * 4. .claude/skills/ref_learnings.md 덮어쓰기
 *
 * 새로운 실수가 없으면 기존 파일 그대로 유지 (no-op).
 * Clean Exit: process.exitCode
 */
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);

const LEARNINGS_PATH = P.learnings;
const FEEDBACK_PATH  = P.qaFeedback;
const RESULT_PATH    = P.qaResult;
const MAX_BULLETS    = 10;

(async () => {
  // ── 1. 새 실수 수집 ───────────────────────────────────────────────────────
  const newMistakes = [];

  // 우선순위 1: 01_qa_feedback.json (QA Fail 시 작성, 가장 상세한 actionable 포함)
  if (fs.existsSync(FEEDBACK_PATH)) {
    const fb = JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf-8'));
    console.log(`📋 [Wrapup] QA 피드백 감지 (점수: ${fb.score ?? '?'}/100)`);

    (fb.feedback || []).forEach(f => newMistakes.push(f));
    (fb.episodes || []).forEach(ep => {
      (ep.actionable_feedback || []).forEach(af => newMistakes.push(`EP${ep.id}: ${af}`));
      (ep.issues || []).filter(i => !(ep.actionable_feedback || []).some(af => af.includes(i)))
        .forEach(i => newMistakes.push(`EP${ep.id}: ${i}`));
    });
  }
  // 우선순위 2: 01_qa_result.json — 이번 회차 Pass여도 이전 실패 흔적이 남아있을 수 있음
  else if (fs.existsSync(RESULT_PATH)) {
    const res = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf-8'));
    if (res.verdict === 'Fail' || (typeof res.score === 'number' && res.score < 85)) {
      console.log(`📋 [Wrapup] QA 결과 파일에서 실패 사유 추출 (점수: ${res.score ?? '?'}/100)`);
      (res.feedback || []).forEach(f => newMistakes.push(f));
      (res.episodes || []).filter(e => !e.pass).forEach(ep => {
        (ep.actionable_feedback || []).forEach(af => newMistakes.push(`EP${ep.id}: ${af}`));
        (ep.issues || []).forEach(i => newMistakes.push(`EP${ep.id}: ${i}`));
      });
    }
  }

  if (newMistakes.length === 0) {
    console.log('✅ [Wrapup] 새로운 실수 없음 — 오답 노트 변경 없이 종료');
    process.exitCode = 0;
    return;
  }

  console.log(`🔍 [Wrapup] 새 실수 ${newMistakes.length}건 → 오답 노트 압축 시작`);

  // ── 2. 기존 오답 노트 로드 ────────────────────────────────────────────────
  const existingLearnings = fs.existsSync(LEARNINGS_PATH)
    ? fs.readFileSync(LEARNINGS_PATH, 'utf-8')
    : '(오답 노트 없음 — 이번 회차가 첫 기록)';

  // ── 3. Gemini로 중복 제거 + 압축 ──────────────────────────────────────────
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    // API 없으면 단순 append만 수행 (압축 없이)
    console.warn('⚠️ GEMINI_API_KEY 없음 — 압축 없이 단순 추가');
    const raw = newMistakes.map(m => `- ${m}`).join('\n');
    const appended = existingLearnings === '(오답 노트 없음 — 이번 회차가 첫 기록)'
      ? raw
      : existingLearnings + '\n' + raw;
    fs.writeFileSync(LEARNINGS_PATH, appended, 'utf-8');
    console.log(`💾 [Wrapup] ref_learnings.md 단순 추가 완료 (${newMistakes.length}건)`);
    process.exitCode = 0;
    return;
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const WU_MODEL  = 'gemini-2.5-flash';
  const WU_CONFIG = { temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } };

  const compressPrompt = `
당신은 テンキ爺ラジオ 대본 생성 시스템의 오답 노트 관리자입니다.
아래 "기존 오답 노트"와 "이번 회차 신규 실수 목록"을 받아 최종 오답 노트를 만들어라.

## 압축 규칙 (반드시 준수)
1. 기존 항목과 신규 항목을 합산한 뒤 의미가 같거나 유사한 항목을 하나로 병합하라.
2. 더 구체적이고 즉각적인 수정 지시가 담긴 쪽을 살려라.
3. 최종 결과는 반드시 ${MAX_BULLETS}개 이하의 bullet point로 압축하라.
4. 오래된 일반론(예: "규칙을 잘 지키세요")보다 구체적인 실수 패턴(예: "[溜息] 일본어 지문 사용")을 우선한다.
5. 각 항목은 "어떤 실수를 했고, 어떻게 수정해야 하는가"를 한 줄에 담아라.
6. 마크다운 bullet (`- `) 형식만 사용하고, 헤더나 섹션 구분 없이 bullet list만 반환하라.
7. 코드블록, JSON, 부연 설명 일절 없이 bullet list 텍스트만 반환하라.

## 기존 오답 노트
${existingLearnings}

## 이번 회차 신규 실수 목록
${newMistakes.map(m => `- ${m}`).join('\n')}

## 최종 오답 노트 (${MAX_BULLETS}개 이하 bullet만 출력):`;

  let compressed;
  try {
    const delays = [5000, 15000, 30000];
    for (let i = 0; i <= delays.length; i++) {
      try {
        const result = await ai.models.generateContent({ model: WU_MODEL, contents: compressPrompt, config: WU_CONFIG });
        compressed = result.text.trim();
        break;
      } catch (err) {
        const retryable = err.message?.includes('429') || err.message?.includes('503');
        if (i < delays.length && retryable) {
          console.warn(`   ⚠️ Gemini 오류 — ${delays[i] / 1000}초 후 재시도 (${i + 1}/${delays.length})`);
          await new Promise(r => setTimeout(r, delays[i]));
        } else throw err;
      }
    }
  } catch (err) {
    // 압축 실패 시 단순 append로 fallback
    console.warn(`⚠️ [Wrapup] 압축 실패 (${err.message}) — 단순 추가로 대체`);
    const raw = newMistakes.map(m => `- ${m}`).join('\n');
    const appended = existingLearnings === '(오답 노트 없음 — 이번 회차가 첫 기록)'
      ? raw
      : existingLearnings + '\n' + raw;
    fs.writeFileSync(LEARNINGS_PATH, appended, 'utf-8');
    console.log(`💾 [Wrapup] ref_learnings.md fallback 추가 완료`);
    process.exitCode = 0;
    return;
  }

  // ── 4. bullet 개수 검증 및 초과 시 트리밍 ────────────────────────────────
  const bullets = compressed.split('\n').filter(l => l.trim().startsWith('-'));
  if (bullets.length > MAX_BULLETS) {
    console.warn(`⚠️ [Wrapup] 압축 결과 ${bullets.length}개 → ${MAX_BULLETS}개로 강제 트리밍`);
    compressed = bullets.slice(0, MAX_BULLETS).join('\n');
  }

  // ── 5. ref_learnings.md 덮어쓰기 ─────────────────────────────────────────
  fs.writeFileSync(LEARNINGS_PATH, compressed, 'utf-8');

  const finalCount = compressed.split('\n').filter(l => l.trim().startsWith('-')).length;
  console.log(`✅ [Wrapup] ref_learnings.md 압축 저장 완료 (${finalCount}개 항목)`);
  bullets.slice(0, finalCount).forEach(b => console.log(`   ${b}`));

  process.exitCode = 0;

})().catch(err => {
  console.error('❌ [Wrapup] 내부 오류:', err.message);
  // wrapup 실패는 파이프라인을 중단시키지 않음
  process.exitCode = 0;
});
