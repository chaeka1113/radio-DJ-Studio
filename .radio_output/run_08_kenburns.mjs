/**
 * run_08_kenburns.mjs — Ken Burns 씬별 영상 생성
 *
 * 04_storyboard.json의 씬 이미지에 씬 타입별 켄 번스 효과를 적용해
 * .output/{EP_ID}/videos_kb/{scene_id}.mp4 로 저장한다.
 * DJ_SHOT 타입은 건너뜀.
 *
 * 이미지 해상도 정규화: scale + force_original_aspect_ratio=increase
 *   → pad/crop 미사용, 검은 테두리 줌인 버그 방지
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loadEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

const videosKb = path.join(P.base, 'videos_kb');

// ── 공통 FFmpeg 헬퍼 ────────────────────────────────────────────────────────
// exec 전면 금지 — 버퍼 오버플로우 크래시 방지
// stderr 반드시 소비 — 소비 안 하면 파이프 막혀서 프로세스 멈춤
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args);
    child.stderr.on('data', () => {});
    child.on('close', (code) => {
      code === 0 ? resolve() : reject(new Error(`FFmpeg exit code: ${code}`));
    });
    child.on('error', reject);
  });
}

// ── 메인 실행 (IIFE async) ────────────────────────────────────────────────────
(async () => {

  // 사전 체크
  if (!fs.existsSync(P.storyboard)) {
    console.error('❌ 04_storyboard.json 없음 — run_04_storyboard.mjs를 먼저 실행하세요');
    process.exitCode = 1;
    return;
  }

  const storyboard = JSON.parse(fs.readFileSync(P.storyboard, 'utf-8'));
  const scenes = storyboard.scenes || [];

  if (scenes.length === 0) {
    console.error('❌ 씬이 없습니다');
    process.exitCode = 1;
    return;
  }

  // 출력 디렉토리 생성
  fs.mkdirSync(videosKb, { recursive: true });

  const results = [];
  let successCount = 0, skippedCount = 0, failedCount = 0;
  const total = scenes.length;

  console.log(`🎬 켄 번스 영상 생성 시작 (총 ${total}개 씬)`);

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const { scene_id, type, duration_sec } = scene;
    const outputPath = path.join(videosKb, `${scene_id}.mp4`);
    const imgPath    = path.join(P.images, `${scene_id}.png`);
    const progress   = `[${i + 1}/${total}]`;

    // DJ_SHOT 스킵
    if (type === 'DJ_SHOT') {
      results.push({ scene_id, status: 'skipped_dj', type });
      skippedCount++;
      console.log(`${progress} ${scene_id} (${type}) ⏭ DJ_SHOT 스킵`);
      continue;
    }

    // 이미 존재하면 스킵
    if (fs.existsSync(outputPath)) {
      results.push({ scene_id, status: 'skipped_exists', type });
      skippedCount++;
      console.log(`${progress} ${scene_id} (${type}) ✅ 이미 존재 — 스킵`);
      continue;
    }

    // 이미지 없으면 실패 처리
    if (!fs.existsSync(imgPath)) {
      results.push({ scene_id, status: 'failed', type, error: '이미지 파일 없음' });
      failedCount++;
      console.log(`${progress} ${scene_id} (${type}) ❌ 이미지 없음`);
      continue;
    }

    const duration = duration_sec || 5;
    // 프레임수 = duration × 25fps
    const frames = Math.round(duration * 25);

    // ── 씬 타입별 FFmpeg 필터 ──────────────────────────────────────────────
    // 공통: scale로 1920×1080 이상으로 키운 뒤 zoompan으로 켄번스 적용
    //   force_original_aspect_ratio=increase → 검은 테두리 없이 화면 꽉 참
    //   s=1920x1080 → zoompan 출력 해상도 고정
    let filterStr;

    if (type === 'CHARACTER_SCENE') {
      // 서서히 줌인: 1.0 → 1.08
      filterStr = `scale=1920:1080:force_original_aspect_ratio=increase,zoompan=z='min(zoom+0.0006,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080,fps=25`;

    } else if (type === 'ESTABLISHING') {
      // 좌에서 우로 패닝 (zoom 1.05 고정, x 매 프레임 +2)
      filterStr = `scale=1920:1080:force_original_aspect_ratio=increase,zoompan=z='1.05':x='if(gte(on,1),min(x+2,iw/2),0)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080,fps=25`;

    } else if (type === 'CLOSE_UP') {
      // 매우 천천히 줌인: 1.0 → 1.04
      filterStr = `scale=1920:1080:force_original_aspect_ratio=increase,zoompan=z='min(zoom+0.0003,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080,fps=25`;

    } else if (type === 'FLASHBACK') {
      // 줌아웃: 1.08 → 1.0 + 세피아 톤
      filterStr = `scale=1920:1080:force_original_aspect_ratio=increase,zoompan=z='if(eq(on,1),1.08,max(zoom-0.0006,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080,fps=25,colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131`;

    } else {
      // 알 수 없는 타입 → CHARACTER_SCENE 기본값
      filterStr = `scale=1920:1080:force_original_aspect_ratio=increase,zoompan=z='min(zoom+0.0006,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080,fps=25`;
    }

    // ── FFmpeg 실행 (절대 경로 사용) ────────────────────────────────────────
    try {
      await runFFmpeg([
        '-y',
        '-loop', '1',
        '-i', imgPath,
        '-vf', filterStr,
        '-t', String(duration),
        '-c:v', 'libx264',
        '-preset', 'fast',     // 중간 파일 → fast 충분
        '-pix_fmt', 'yuv420p',
        outputPath,
      ]);

      results.push({ scene_id, status: 'success', type });
      successCount++;
      console.log(`${progress} ${scene_id} (${type}) ✅`);

    } catch (err) {
      results.push({ scene_id, status: 'failed', type, error: err.message });
      failedCount++;
      console.log(`${progress} ${scene_id} (${type}) ❌ ${err.message.slice(0, 80)}`);
      // 해당 씬만 실패 처리 후 계속 진행
    }
  }

  // ── 결과 저장 ─────────────────────────────────────────────────────────────
  const output = {
    results,
    summary: { success: successCount, skipped: skippedCount, failed: failedCount },
  };
  fs.writeFileSync(P.kenburnsResults, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✅ 켄 번스 완료 — 성공: ${successCount}, 스킵: ${skippedCount}, 실패: ${failedCount}`);
  console.log(`📋 ${P.kenburnsResults}`);

  if (failedCount > 0) process.exitCode = 1;

})().catch(err => {
  console.error('❌ 켄 번스 내부 오류:', err.message);
  process.exitCode = 1;
});
