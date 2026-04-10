/**
 * run_00_extract_meta.mjs  (최초 1회 실행)
 * CapCut 소스 프로젝트에서 draft_meta_info.json만 박제한다.
 * draft_content.json은 절대 읽지 않는다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 로드 (루트 기준)
config({ path: path.join(__dirname, '..', '.env') });

const SOURCE_DIR = process.env.CAPCUT_SOURCE_PROJECT_DIR;

if (!SOURCE_DIR) {
  console.error('❌ CAPCUT_SOURCE_PROJECT_DIR 환경변수가 .env에 없습니다.');
  console.error('   예시: CAPCUT_SOURCE_PROJECT_DIR=C:/Users/.../com.lveditor.draft/RADIO_EP2');
  process.exit(1);
}

if (!fs.existsSync(SOURCE_DIR)) {
  console.error(`❌ 소스 폴더가 존재하지 않습니다: ${SOURCE_DIR}`);
  process.exit(1);
}

const srcMetaPath = path.join(SOURCE_DIR, 'draft_meta_info.json');
if (!fs.existsSync(srcMetaPath)) {
  console.error(`❌ draft_meta_info.json을 찾을 수 없습니다: ${srcMetaPath}`);
  process.exit(1);
}

// 박제 대상 경로
const destDir  = path.join(__dirname, 'master_template');
const destPath = path.join(destDir, 'draft_meta_info.json');

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(srcMetaPath, destPath);

console.log(`✅ draft_meta_info.json 박제 완료`);
console.log(`   소스: ${srcMetaPath}`);
console.log(`   저장: ${destPath}`);
