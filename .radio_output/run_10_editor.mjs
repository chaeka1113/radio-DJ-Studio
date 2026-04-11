/**
 * run_10_editor.mjs — 최종 영상 조립 (켄 번스 씬 + TTS 오디오 + 라디오 UI)
 *
 * EP별 씬 concat → 오디오와 길이 비교 (루핑 여부 결정) → 파형+UI 오버레이 합성
 * → .output/{EP_ID}/videos_final/ep{N}_final.mp4 × 3 → full_broadcast.mp4
 *
 * 유튜브 최적화:
 *   -crf 18          고품질 (18~23 권장, 낮을수록 고품질)
 *   -preset slow     압축 효율 높임 (파일 크기 절감)
 *   -ar 44100        ElevenLabs 원본 샘플레이트 유지 (Vrew 싱크 보호)
 *   -movflags +faststart  유튜브 업로드 처리 최적화
 *   -pix_fmt yuv420p      범용 호환성 확보
 */
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loadEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

const videosKb    = path.join(P.base, 'videos_kb');
const videosFinal = path.join(P.base, 'videos_final');

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

  // ── 사전 체크: ep_durations.json ─────────────────────────────────────────
  const durPath = path.join(P.audio, 'ep_durations.json');
  if (!fs.existsSync(durPath)) {
    console.error('❌ ep_durations.json 없음 — run_07_audio.mjs를 먼저 실행하세요');
    process.exitCode = 1;
    return;
  }
  const epDurations = JSON.parse(fs.readFileSync(durPath, 'utf-8'));

  // ── 사전 체크: storyboard ────────────────────────────────────────────────
  if (!fs.existsSync(P.storyboard)) {
    console.error('❌ 04_storyboard.json 없음 — run_04_storyboard.mjs를 먼저 실행하세요');
    process.exitCode = 1;
    return;
  }
  const storyboard = JSON.parse(fs.readFileSync(P.storyboard, 'utf-8'));
  const scenes = storyboard.scenes || [];

  // ── 출력 디렉토리 생성 ────────────────────────────────────────────────────
  fs.mkdirSync(videosFinal, { recursive: true });

  // ── 폰트 설정 (Windows/Mac/Linux 분기) ──────────────────────────────────
  // Windows drawtext fontfile 경로: 드라이브 콜론을 \\: 로 이스케이프
  // (FFmpeg 필터 파서가 : 를 옵션 구분자로 해석하는 것 방지)
  let escapedFont = null;
  let useFontfile = false;

  if (process.platform === 'win32') {
    const winFont = 'C:/Windows/Fonts/msgothic.ttc';
    if (fs.existsSync(winFont)) {
      // C:/path → C\\:/path  (FFmpeg에 전달되는 실제 문자열)
      escapedFont = winFont.replace(/^([A-Z]):/, '$1\\\\:');
      useFontfile = true;
    }
  } else if (process.platform === 'darwin') {
    const macFont = '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc';
    if (fs.existsSync(macFont)) {
      escapedFont = macFont;
      useFontfile = true;
    }
  }

  if (!useFontfile) {
    console.log('⚠️ 일본어 폰트 없음 — drawtext fontfile 옵션 제거');
  }

  // ── EP별 처리 ────────────────────────────────────────────────────────────
  for (let epIdx = 1; epIdx <= 3; epIdx++) {
    const epKey = `ep${epIdx}`;
    const audioDur  = epDurations[`${epKey}_script_sec`];
    const audioFile = epDurations[`${epKey}_audio_path`];

    if (!audioDur || !audioFile) {
      console.error(`❌ EP${epIdx} 오디오 정보 없음 — ep_durations.json 확인`);
      continue;
    }

    console.log(`\n🎬 EP${epIdx} 조립 중... (오디오: ${audioDur.toFixed(1)}초)`);

    // ── 1. 스토리 씬 목록 추출 (episode_id=N, type≠DJ_SHOT) ──────────────
    const epScenes = scenes.filter(s => s.episode_id === epIdx && s.type !== 'DJ_SHOT');
    if (epScenes.length === 0) {
      console.error(`❌ EP${epIdx} 스토리 씬 없음`);
      continue;
    }

    // 켄 번스 영상이 있는 씬만 포함
    const validScenes = epScenes.filter(s =>
      fs.existsSync(path.join(videosKb, `${s.scene_id}.mp4`))
    );
    if (validScenes.length === 0) {
      console.error(`❌ EP${epIdx} 켄 번스 영상 없음 — run_08_kenburns.mjs를 먼저 실행하세요`);
      continue;
    }

    // ── 2. list.txt 생성 (EP_ID 디렉토리 기준 절대 경로) ────────────────
    const listPath = path.join(P.base, `ep${epIdx}_list.txt`);
    const listEntries = validScenes.map(s =>
      `file '${path.join(videosKb, `${s.scene_id}.mp4`).replace(/\\/g, '/')}'`
    );
    fs.writeFileSync(listPath, listEntries.join('\n'), 'utf-8');
    console.log(`   📋 ep${epIdx}_list.txt 생성 (${listEntries.length}개 씬)`);

    // ── 3. 씬 concat (copy 코덱, 중간 파일) ──────────────────────────────
    const rawOutput = path.join(P.base, `scenes_ep${epIdx}_raw.mp4`);
    console.log(`   🔗 씬 concat 중...`);
    try {
      // -f concat -safe 0 반드시 포함
      await runFFmpeg([
        '-f', 'concat', '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        '-y', rawOutput,
      ]);
    } catch (err) {
      console.error(`   ❌ EP${epIdx} concat 실패: ${err.message}`);
      continue;
    }

    // ── 4. 영상/오디오 길이 비교 ─────────────────────────────────────────
    // parseFloat + toString().trim() 필수 — 개행문자가 FFmpeg 수식 파서 고장 유발
    const videoDur = parseFloat(
      execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${rawOutput}"`
      ).toString().trim()
    );
    console.log(`   📐 영상: ${videoDur.toFixed(1)}초, 오디오: ${audioDur.toFixed(1)}초`);

    const needsLoop = videoDur < audioDur;
    console.log(`   🔄 루핑 ${needsLoop ? 'ON (영상 < 오디오)' : 'OFF (영상 >= 오디오)'}`);

    // ── 5. 오버레이 합성 ─────────────────────────────────────────────────
    // 오디오 파형: aformat=channel_layouts=mono 먼저 적용
    //   → ElevenLabs 스테레오 출력 시 파형이 2채널로 분리되는 버그 방지
    // 라디오 UI: 상단 반투명 바 + EP 번호 / 하단 고정 진행 바
    const dtPrefix = useFontfile ? `fontfile='${escapedFont}':` : '';
    const epText = `EP${epIdx}`;

    const filterComplex = [
      // 오디오 → 모노 파형 생성
      `[1:a]aformat=channel_layouts=mono,showwaves=s=1920x120:mode=cline:colors=0xEF9F27:scale=sqrt:rate=25[waves]`,
      // 파형 오버레이 (하단 120px)
      `[0:v][waves]overlay=0:H-120[vw]`,
      // 라디오 UI 오버레이
      `[vw]drawbox=x=0:y=0:w=W:h=70:color=black@0.6:t=fill,` +
      `drawtext=${dtPrefix}text='${epText}':fontcolor=#EF9F27:fontsize=28:x=w-100:y=22,` +
      `drawbox=x=0:y=H-124:w=W:h=4:color=#EF9F27@0.9:t=fill[out]`,
    ].join(';');

    // 입력 인수 (루핑 여부에 따라 분기)
    const videoInputArgs = needsLoop
      ? ['-stream_loop', '-1', '-i', rawOutput]
      : ['-i', rawOutput];

    // -vsync cfr: 루핑 경계 타임스탬프 드리프트 방지
    const syncArgs = needsLoop ? ['-vsync', 'cfr', '-shortest'] : ['-shortest'];

    const finalOutput = path.join(videosFinal, `ep${epIdx}_final.mp4`);
    console.log(`   🎞 최종 합성 중... → ep${epIdx}_final.mp4`);

    try {
      await runFFmpeg([
        ...videoInputArgs,
        '-i', audioFile,        // ep_durations.json에서 읽은 절대 경로
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-map', '1:a',
        ...syncArgs,
        '-c:v', 'libx264',
        '-crf', '18',           // 고품질 (18~23 권장)
        '-preset', 'slow',      // 압축 효율 높임 (파일 크기 절감)
        '-c:a', 'aac',
        '-ar', '44100',         // ElevenLabs 원본 샘플레이트 유지 (Vrew 싱크 보호)
        '-pix_fmt', 'yuv420p',  // 범용 호환성
        '-movflags', '+faststart', // 유튜브 업로드 처리 최적화
        '-y', finalOutput,
      ]);

      console.log(`   ✅ EP${epIdx} 완료 → ${finalOutput}`);

    } catch (err) {
      console.error(`   ❌ EP${epIdx} 합성 실패: ${err.message}`);
    }
  }

  // ── full_broadcast.mp4 생성 (재인코딩 필수) ──────────────────────────────
  // -c copy 절대 금지 — 스트림 파라미터 불일치로 재생 끊김 발생
  console.log('\n🎞 full_broadcast.mp4 생성 중...');

  const fullListPath = path.join(P.base, 'full_list.txt');
  const fullEntries = [1, 2, 3]
    .filter(n => fs.existsSync(path.join(videosFinal, `ep${n}_final.mp4`)))
    .map(n => `file '${path.join(videosFinal, `ep${n}_final.mp4`).replace(/\\/g, '/')}'`);

  if (fullEntries.length === 0) {
    console.error('❌ ep_final.mp4 파일이 없어 full_broadcast 생성 불가');
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(fullListPath, fullEntries.join('\n'), 'utf-8');

  const fullBroadcast = path.join(videosFinal, 'full_broadcast.mp4');
  try {
    await runFFmpeg([
      '-f', 'concat', '-safe', '0',
      '-i', fullListPath,
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'slow',
      '-c:a', 'aac',
      '-ar', '44100',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', fullBroadcast,
    ]);

    console.log('✅ full_broadcast.mp4 생성 완료');
  } catch (err) {
    console.error(`❌ full_broadcast 생성 실패: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log('\n🎉 전체 영상 조립 완료!');
  console.log(`📁 ${videosFinal}`);
  console.log('   ├── ep1_final.mp4');
  console.log('   ├── ep2_final.mp4');
  console.log('   ├── ep3_final.mp4');
  console.log('   └── full_broadcast.mp4');

})().catch(err => {
  console.error('❌ 편집기 내부 오류:', err.message);
  process.exitCode = 1;
});
