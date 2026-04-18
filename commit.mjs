#!/usr/bin/env node
/**
 * commit.mjs — 스마트 자동 커밋 & 푸시
 * 사용법: node commit.mjs
 */

import { execSync } from 'child_process';
import { loadEnv, requireEnv } from './.radio_output/lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';

loadEnv();

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, ...opts }).trim();
}

// ── 변경사항 확인 ──────────────────────────────────────────────
const status = run('git status --porcelain');
if (!status) {
  console.log('✅ 변경사항 없음 — 스킵');
  process.exit(0);
}

const stat = run('git diff HEAD --stat');
const diff = run('git diff HEAD -- . ":(exclude)node_modules" ":(exclude).output" ":(exclude)*.png" ":(exclude)*.mp3" ":(exclude)*.mp4"');

console.log('📊 변경 내역:');
console.log(stat || '(새 파일 포함)');

// ── Claude로 커밋 메시지 생성 ──────────────────────────────────
const API_KEY = requireEnv('ANTHROPIC_API_KEY');
const client = new Anthropic({ apiKey: API_KEY });

console.log('\n🧠 커밋 메시지 생성 중...');

const msg = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 256,
  messages: [{
    role: 'user',
    content: `아래 git diff를 보고 커밋 메시지를 한국어로 작성하라.

규칙:
- 첫 줄: "<타입>: <변경 요약>" (50자 이내)
  타입: feat(새기능) | fix(버그수정) | refactor(리팩터) | chore(설정/기타) | docs(문서)
- 첫 줄만 출력. 설명 없이 메시지 텍스트만 반환.

git diff --stat:
${stat}

git diff (핵심 변경):
${diff.slice(0, 3000)}`,
  }],
});

const commitMsg = msg.content[0].text.trim().split('\n')[0];
console.log(`💬 커밋 메시지: ${commitMsg}`);

// ── git add → commit → push ────────────────────────────────────
console.log('\n📦 git add -A ...');
run('git add -A');

console.log('📝 git commit ...');
run(`git commit -m "${commitMsg.replace(/"/g, "'")}"`);

console.log('🚀 git push origin main ...');
run('git push origin main');

console.log('\n✅ 완료! https://github.com/chaeka1113/radio-DJ-Studio');
