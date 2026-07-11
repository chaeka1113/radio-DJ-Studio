/**
 * EP_13_youtube 이미지 rename 스크립트
 * 구 SC001~SC045 → 신 storyboard SC ID로 매핑
 * EP3(SC043~SC067), EP1 추가분(SC017~SC018), EP2 추가분(SC039~SC040)은 이미지 생성 대상
 */
import fs from 'fs';
import path from 'path';

const imgDir  = 'C:/radio-dj-studio/.output/EP_13_youtube/images';
const bkpDir  = 'C:/radio-dj-studio/.output/EP_13_youtube/images_pre_rename';

// ── 1. 기존 이미지 전체를 백업 폴더로 이동 ───────────────────────────────────
fs.mkdirSync(bkpDir, { recursive: true });
for (let i = 1; i <= 45; i++) {
  const sc  = `SC${String(i).padStart(3, '0')}`;
  const src = path.join(imgDir, `${sc}.png`);
  const dst = path.join(bkpDir, `${sc}.png`);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dst);
  }
}
console.log('✅ 기존 45개 이미지 백업 완료 →', bkpDir);

// ── 2. 구 SC → 신 SC 매핑 정의 ───────────────────────────────────────────────
// 규칙:
//   SC001        : 오프닝 DJ (동일)
//   SC002~SC016  : EP1 씬 1~15 (동일)
//   SC017~SC018  : 구 전환 DJ → 신 SC019~SC020 (전환)
//   SC019~SC036  : 구 EP2 씬 1~18 → 신 SC021~SC038
//   SC037~SC038  : 구 QA 1~2 → 신 SC041~SC042 (EP3 전환 DJ)
//   SC039~SC045  : 구 QA 3~9 → 신 SC068~SC074 (QA)
// 신규 생성 대상 (매핑 없음): SC017, SC018(EP1 추가), SC039, SC040(EP2 추가), SC043~SC067(EP3)
const mapping = {
  SC001: 'SC001',
  SC002: 'SC002', SC003: 'SC003', SC004: 'SC004', SC005: 'SC005',
  SC006: 'SC006', SC007: 'SC007', SC008: 'SC008', SC009: 'SC009',
  SC010: 'SC010', SC011: 'SC011', SC012: 'SC012', SC013: 'SC013',
  SC014: 'SC014', SC015: 'SC015', SC016: 'SC016',
  // 구 전환 → 신 전환
  SC017: 'SC019', SC018: 'SC020',
  // 구 EP2 → 신 EP2 (+2 shift)
  SC019: 'SC021', SC020: 'SC022', SC021: 'SC023', SC022: 'SC024',
  SC023: 'SC025', SC024: 'SC026', SC025: 'SC027', SC026: 'SC028',
  SC027: 'SC029', SC028: 'SC030', SC029: 'SC031', SC030: 'SC032',
  SC031: 'SC033', SC032: 'SC034', SC033: 'SC035', SC034: 'SC036',
  SC035: 'SC037', SC036: 'SC038',
  // 구 QA → 신 EP3 전환 DJ + QA
  SC037: 'SC041', SC038: 'SC042',
  SC039: 'SC068', SC040: 'SC069', SC041: 'SC070', SC042: 'SC071',
  SC043: 'SC072', SC044: 'SC073', SC045: 'SC074',
};

// ── 3. 백업에서 새 이름으로 복사 ─────────────────────────────────────────────
let ok = 0, missing = 0;
for (const [oldSc, newSc] of Object.entries(mapping)) {
  const src = path.join(bkpDir, `${oldSc}.png`);
  const dst = path.join(imgDir,  `${newSc}.png`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log(`  ✅ ${oldSc} → ${newSc}`);
    ok++;
  } else {
    console.warn(`  ⚠️  ${oldSc}.png 백업 없음 (skip)`);
    missing++;
  }
}

console.log(`\n완료: ${ok}개 rename, ${missing}개 누락`);
console.log('신규 생성 대상: SC017, SC018, SC039, SC040 (EP1·EP2 추가분) + SC043~SC067 (EP3 25씬)');
console.log('백업 보존 위치:', bkpDir);
