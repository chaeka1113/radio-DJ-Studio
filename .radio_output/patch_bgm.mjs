/**
 * patch_bgm.mjs
 * EP_2_YOUTUBE, EP_3_youtube의 BGM을 새 파일로 교체한다.
 * - 파일 길이 - 10s 초과 세그먼트는 2개로 분할 (source 처음부터 반복)
 * - ref_capcut_materials.json 의 bgm 섹션도 업데이트
 * - run_06_capcut_builder.mjs 의 BGM_VOL 상수도 업데이트
 */

import fs   from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const newUUID    = () => randomUUID().toUpperCase();
const deepClone  = (o) => JSON.parse(JSON.stringify(o));

// ── 새 BGM 설정 ──────────────────────────────────────────────────────────────
const NEW_PATH     = 'C:/radio-dj-studio/.output/Lifting Dreams - Aakash Gandhi.mp3';
const NEW_DUR      = 188_033_333;
const NEW_VOL      = 0.17782793939113617;
const BGM_MARGIN   = 10_000_000;
const BGM_SRC_MAX  = NEW_DUR - BGM_MARGIN;  // 178_033_333

const DRAFTS_BASE  = 'C:\\Users\\채결사\\AppData\\Local\\CapCut\\User Data\\Projects\\com.lveditor.draft';
const EPS          = ['EP_2_YOUTUBE', 'EP_3_youtube'];

// ── aux 카테고리 (세그먼트가 참조하는 보조 material 배열 이름) ─────────────────
const AUX_CATS = [
  'speeds', 'placeholder_infos', 'audio_fades',
  'beats', 'realtime_denoises', 'sound_channel_mappings', 'vocal_separations',
];

/**
 * 세그먼트의 extra_material_refs 를 deep-clone 하여 새 UUID로 교체.
 * 새 aux material 엔트리도 JSON에 추가한다.
 */
function cloneAuxRefs(seg, json) {
  const newRefs = [];
  for (const refId of seg.extra_material_refs) {
    let cloned = false;
    for (const cat of AUX_CATS) {
      const existing = (json.materials[cat] || []).find(m => m.id === refId);
      if (existing) {
        const copy = deepClone(existing);
        copy.id = newUUID();
        json.materials[cat].push(copy);
        newRefs.push(copy.id);
        cloned = true;
        break;
      }
    }
    if (!cloned) newRefs.push(refId);  // 못 찾으면 원본 ref 유지
  }
  return newRefs;
}

// ── 각 EP 처리 ────────────────────────────────────────────────────────────────
for (const ep of EPS) {
  const filePath = path.join(DRAFTS_BASE, ep, 'draft_content.json');
  console.log(`\n▶ ${ep}`);

  const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // BGM 트랙: volume < 0.1 인 세그먼트를 가진 audio 트랙
  const bgmTrack = json.tracks.find(
    t => t.type === 'audio' && t.segments.some(s => s.volume < 0.1)
  );
  if (!bgmTrack) { console.error('  ❌ BGM 트랙 없음'); continue; }

  const newSegments = [];
  let splitCount = 0;

  for (const seg of bgmTrack.segments) {
    const targetStart = seg.target_timerange.start;
    const targetDur   = seg.target_timerange.duration;

    // 현재 세그먼트가 참조하는 material을 업데이트 (path, duration)
    const mat = json.materials.audios.find(m => m.id === seg.material_id);
    if (mat) {
      mat.path     = NEW_PATH;
      mat.duration = NEW_DUR;
    }

    if (targetDur <= BGM_SRC_MAX) {
      // ── 분할 불필요: 볼륨만 교체 ──────────────────────────────────────────
      seg.volume = NEW_VOL;
      // source_timerange duration도 동일하게 유지 (코드 규칙: srcDur == dur)
      seg.source_timerange.duration = targetDur;
      newSegments.push(seg);
      console.log(`  [유지] start=${(targetStart/1e6).toFixed(2)}s dur=${(targetDur/1e6).toFixed(2)}s`);
    } else {
      // ── 분할 필요: A(MAX) + B(나머지) ───────────────────────────────────
      const durA = BGM_SRC_MAX;
      const durB = targetDur - BGM_SRC_MAX;

      // Segment A — 기존 material 재사용 (이미 path/dur 위에서 업데이트됨)
      const segA      = deepClone(seg);
      segA.id         = newUUID();
      segA.volume     = NEW_VOL;
      segA.target_timerange  = { start: targetStart,          duration: durA };
      segA.source_timerange  = { start: 0,                    duration: durA };
      // extra_material_refs: 기존 것 그대로 (material들은 이미 존재)
      newSegments.push(segA);

      // Segment B — 새 material + 새 aux refs 생성
      const matB  = deepClone(mat);
      matB.id     = newUUID();
      json.materials.audios.push(matB);

      const segB      = deepClone(seg);
      segB.id         = newUUID();
      segB.material_id = matB.id;
      segB.volume     = NEW_VOL;
      segB.target_timerange  = { start: targetStart + durA,   duration: durB };
      segB.source_timerange  = { start: 0,                    duration: durB };
      segB.extra_material_refs = cloneAuxRefs(seg, json);
      newSegments.push(segB);

      splitCount++;
      console.log(`  [분할] start=${(targetStart/1e6).toFixed(2)}s → A:${(durA/1e6).toFixed(2)}s + B:${(durB/1e6).toFixed(2)}s`);
    }
  }

  bgmTrack.segments = newSegments;
  console.log(`  총 BGM 세그먼트: ${bgmTrack.segments.length}개 (분할 ${splitCount}건)`);

  fs.writeFileSync(filePath, JSON.stringify(json), 'utf-8');
  console.log(`  ✅ 저장 완료: ${filePath}`);
}

// ── ref_capcut_materials.json 업데이트 ────────────────────────────────────────
const refMatPath = new URL('../.radio_output/ref_capcut_materials.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const refMat     = JSON.parse(fs.readFileSync(refMatPath, 'utf-8'));
refMat.bgm.path     = NEW_PATH;
refMat.bgm.duration = NEW_DUR;
refMat.bgm.durationSec = NEW_DUR / 1_000_000;
// id는 런타임에 newUUID()로 교체되므로 유지
fs.writeFileSync(refMatPath, JSON.stringify(refMat, null, 2), 'utf-8');
console.log(`\n✅ ref_capcut_materials.json bgm 업데이트 완료`);

// ── run_06_capcut_builder.mjs BGM_VOL 상수 업데이트 ──────────────────────────
const run06Path = new URL('../.radio_output/run_06_capcut_builder.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const run06     = fs.readFileSync(run06Path, 'utf-8');
const updated06 = run06.replace(
  /const BGM_VOL\s*=\s*[\d.]+;/,
  `const BGM_VOL          = ${NEW_VOL};`
);
if (updated06 === run06) {
  console.warn('⚠  run_06: BGM_VOL 패턴 못 찾음 — 수동 확인 필요');
} else {
  fs.writeFileSync(run06Path, updated06, 'utf-8');
  console.log(`✅ run_06_capcut_builder.mjs BGM_VOL → ${NEW_VOL}`);
}

console.log('\n🎵 BGM 교체 완료');
