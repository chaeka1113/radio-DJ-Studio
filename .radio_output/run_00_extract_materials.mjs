import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const capCutDir = path.join(__dirname, 'capcut_output');

// ── 1. 마스터 JSON 탐색 ──────────────────────────────────────────────
let masterPath = null;

if (fs.existsSync(capCutDir)) {
  const candidates = fs.readdirSync(capCutDir)
    .filter(f => f.includes('마스터') && f.endsWith('.json'));

  if (candidates.length > 0) {
    masterPath = path.join(capCutDir, candidates[0]);
    console.log(`✅ 마스터 JSON 발견: capcut_output/${candidates[0]}`);
  }
}

if (!masterPath) {
  console.error('❌ 마스터 JSON을 찾을 수 없습니다.');
  console.error('   경로: .radio_output/capcut_output/draft_content_마스터_.json');
  process.exit(1);
}

const master = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
const audios = master?.materials?.audios;

if (!Array.isArray(audios) || audios.length === 0) {
  console.error('❌ materials.audios 배열을 찾을 수 없습니다.');
  process.exit(1);
}

// ── 2. duration 기준 material 추출 ──────────────────────────────────
function findAudio(audios, durSecApprox, tolerance = 2.0) {
  // 동일 파일이 여러 material ID로 중복 등록되어 있으므로 첫 번째만 추출
  const found = audios.find(a =>
    a.duration &&
    Math.abs(a.duration / 1_000_000 - durSecApprox) < tolerance &&
    a.path && a.path.includes('Cache')
  );
  if (!found) {
    throw new Error(`material 못 찾음: ~${durSecApprox}s (tolerance ±${tolerance}s)`);
  }
  return {
    id: found.id,                              // 재사용 시 새 UUID로 교체됨 (참고용)
    path: found.path,                          // 캐시 절대경로 (이 PC에서만 유효)
    duration: found.duration,                 // μs
    durationSec: found.duration / 1_000_000,
  };
}

let result;
try {
  result = {
    _comment: '최초 1회 추출. 같은 PC에서 영구 유효. 다른 PC로 이전 시 재추출 필요.',
    _extractedAt: new Date().toISOString(),
    _masterFile: path.basename(masterPath),
    radio_noise: findAudio(audios, 33.07),   // ~33s 씬 전환용 노이즈
    pc_click:    findAudio(audios,  1.77),   // ~1.8s 클릭음
    bgm:         findAudio(audios, 122.2),   // ~122s 배경음악 (vol=0.05)
  };
} catch (err) {
  console.error(`❌ ${err.message}`);
  console.error('   audios 목록 (duration / path 앞 60자):');
  audios.forEach((a, i) => {
    const sec = a.duration ? (a.duration / 1_000_000).toFixed(3) : '?';
    const p   = a.path ? a.path.slice(0, 60) : '(no path)';
    console.error(`   [${i}] ${sec}s  ${p}`);
  });
  process.exit(1);
}

// ── 3. sticker 추출 ──────────────────────────────────────────────────
const stickers = master.materials?.stickers || [];
const audiowave = stickers.find(s => s.name && s.name.includes('Audiowave'));
if (!audiowave) {
  console.warn('⚠️  Audiowave 스티커를 찾지 못했습니다. 수동 확인 필요.');
} else {
  result.audiowave_sticker = {
    sticker_id:  audiowave.sticker_id,
    resource_id: audiowave.resource_id,
    name:        audiowave.name,
    path:        audiowave.path,
    category_id: audiowave.category_id,
  };
  console.log(`   audiowave   : ${audiowave.name}  id=${audiowave.sticker_id}`);
}

// ── 4. 저장 ─────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'ref_capcut_materials.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');

console.log('✅ ref_capcut_materials.json 생성 완료');
console.log(`   radio_noise : ${result.radio_noise.durationSec.toFixed(3)}s  ...${result.radio_noise.path.slice(-40)}`);
console.log(`   pc_click    : ${result.pc_click.durationSec.toFixed(3)}s  ...${result.pc_click.path.slice(-40)}`);
console.log(`   bgm         : ${result.bgm.durationSec.toFixed(3)}s  ...${result.bgm.path.slice(-40)}`);

// ── 5. gitignore 안내 ───────────────────────────────────────────────
console.log('');
console.log('⚠️  ref_capcut_materials.json 은 이 PC의 CapCut 캐시 경로를 포함합니다.');
console.log('   .gitignore 에 추가하세요:');
console.log('   .radio_output/ref_capcut_materials.json');
