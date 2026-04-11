/**
 * lib/retry.mjs — Gemini/Anthropic API 공통 재시도 헬퍼
 *
 * 429(Rate Limit) / 503(Overloaded) 에 대해 지수 백오프 재시도.
 * 429는 쿼터 복구 시간을 고려해 대기 시간을 2배 적용.
 *
 * Usage:
 *   import { withRetry } from '../lib/retry.mjs';
 *   const result = await withRetry(() => model.generateContent(prompt), 'EP1');
 */

/**
 * @param {() => Promise<any>} fn        실행할 비동기 함수
 * @param {string}             label     로그 식별자 (e.g. 'EP1', '씬 003')
 * @param {number}             maxRetries 최대 재시도 횟수 (기본 3)
 * @param {number[]}           delays    재시도 대기 ms 배열 (기본 10s/30s/60s)
 */
export async function withRetry(fn, label, maxRetries = 3, delays = [10000, 30000, 60000]) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg    = err.message ?? '';
      const is503  = msg.includes('503') || /unavailable|overloaded/i.test(msg);
      const is429  = msg.includes('429') || /quota|rate/i.test(msg);
      const retryable = is503 || is429;

      if (i < maxRetries && retryable) {
        const base = delays[Math.min(i, delays.length - 1)];
        const wait = is429 ? base * 2 : base;
        console.warn(`   ⚠️ [${label}] ${is429 ? '429 쿼터' : '503 과부하'} — ${wait / 1000}초 후 재시도 (${i + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}
