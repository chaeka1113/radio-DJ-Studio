/**
 * lib/env.mjs — 공통 .env 로더
 *
 * 기존 run_*.mjs 파일마다 중복 구현된 환경변수 로더를 단일 모듈로 통합.
 * process.env에 이미 존재하는 키는 덮어쓰지 않는다 (CI 환경 우선).
 *
 * Usage:
 *   import { loadEnv, requireEnv, ROOT_DIR } from '../lib/env.mjs';
 *   loadEnv();
 *   const key = requireEnv('ANTHROPIC_API_KEY');
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** 프로젝트 루트 (radio-dj-studio/) */
export const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..'
);

/**
 * .env 파일을 읽어 process.env에 주입.
 * 이미 설정된 키는 건드리지 않음.
 */
export function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim().replace(/^["']|["']$/g, ''); // 따옴표 제거
    if (!process.env[k]) process.env[k] = v;
  }
}

/**
 * 필수 환경변수를 읽어 반환. 없으면 즉시 process.exit(1).
 * @param {string} key
 * @returns {string}
 */
export function requireEnv(key) {
  const val = process.env[key];
  if (!val) {
    console.error(`❌ 환경변수 없음: ${key}`);
    console.error(`   .env 파일에 ${key}=<값> 을 추가하세요.`);
    process.exit(1);
  }
  return val;
}
