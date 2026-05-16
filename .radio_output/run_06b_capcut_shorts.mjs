/**
 * run_06b_capcut_shorts.mjs — Shorts 전용 CapCut 프로젝트 빌더
 *
 * 스코프: Q&A 씬 (qa_shot=true) + 07_qa_and_closing 오디오
 * 캔버스: 1080×1920 (9:16)
 * 출력:   .output/{EP_ID}/capcut_shorts/draft_content.json → CapCut 드래프트 폴더
 *
 * 기존 run_06_capcut_builder.mjs를 일절 수정하지 않음.
 * 이 파일은 Shorts 전용 독립 파이프라인.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { loadEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';
import { loadTextStyle, buildSubtitles, buildTextTrack } from './lib/capcut_text.mjs';

loadEnv();
const epId   = process.env.EP_ID ?? generateEpId();
const P      = makePaths(epId);
ensureDirs(P);
const newUUID  = () => randomUUID().toUpperCase();
const toUs     = (sec) => Math.round(sec * 1_000_000);
const normPath = (p) => (p || '').replace(/\\/g, '/');

// ── --single-qa N 모드 ────────────────────────────────────────────────────────
const singleQaArgIdx = process.argv.indexOf('--single-qa');
const SINGLE_QA = singleQaArgIdx >= 0 ? parseInt(process.argv[singleQaArgIdx + 1], 10) : null;
if (SINGLE_QA !== null && (isNaN(SINGLE_QA) || SINGLE_QA < 1 || SINGLE_QA > 5)) {
  console.error('❌ --single-qa N: N은 1~5 사이 정수');
  process.exit(1);
}

// ── Shorts 전용 경로 ──────────────────────────────────────────────────────────
const IMAGE_SHORTS_DIR  = path.join(P.base, 'images_shorts');
const IMAGE_SEARCH_DIR  = SINGLE_QA !== null
  ? path.join(IMAGE_SHORTS_DIR, `QA${SINGLE_QA}`)
  : IMAGE_SHORTS_DIR;
const CAPCUT_SHORTS_DIR = path.join(P.base, `${epId}_shorts`);
const CAPCUT_QA_DIR     = SINGLE_QA !== null
  ? path.join(P.base, `${epId}_QA${SINGLE_QA}_shorts`)
  : CAPCUT_SHORTS_DIR;
fs.mkdirSync(CAPCUT_QA_DIR, { recursive: true });
const OUTPUT_PATH = path.join(CAPCUT_QA_DIR, 'draft_content.json');

// ── 전제조건 확인 ─────────────────────────────────────────────────────────────
if (!fs.existsSync(P.capcutMaterials)) {
  console.error('❌ ref_capcut_materials.json 없음');
  process.exit(1);
}
const REF = JSON.parse(fs.readFileSync(P.capcutMaterials, 'utf-8').replace(/^﻿/, ''));

if (!fs.existsSync(P.capcutTemplate)) {
  console.error('❌ draft_content_마스터_.json 없음 (템플릿 참조용)');
  process.exit(1);
}
const template = JSON.parse(fs.readFileSync(P.capcutTemplate, 'utf-8'));
const tmats    = template.materials;

if (!fs.existsSync(P.storyboard)) {
  console.error('❌ 04_storyboard.json 없음');
  process.exit(1);
}
const storyboard  = JSON.parse(fs.readFileSync(P.storyboard, 'utf-8'));
const qaScenes    = (storyboard.scenes ?? []).filter(s => s.qa_shot === true);
if (qaScenes.length === 0) {
  console.error('❌ qa_shot=true 씬 없음 — --qa 플래그로 파이프라인을 실행하세요');
  process.exit(1);
}

// ── Q&A 오디오 청크 로드 ─────────────────────────────────────────────────────
const QA_CHUNK_ID = '07_qa_and_closing';
const mp3Path = path.join(P.audio, `${QA_CHUNK_ID}.mp3`);
const tsPath  = path.join(P.audio, `${QA_CHUNK_ID}_timestamps.json`);

if (!fs.existsSync(mp3Path)) {
  console.error(`❌ ${QA_CHUNK_ID}.mp3 없음 — run_07_audio.mjs 먼저 실행`);
  process.exit(1);
}
if (!fs.existsSync(tsPath)) {
  console.error(`❌ ${QA_CHUNK_ID}_timestamps.json 없음 — run_07_audio.mjs 먼저 실행`);
  process.exit(1);
}

const tsData = JSON.parse(fs.readFileSync(tsPath, 'utf-8'));

function getMp3Duration(p) {
  const out = execSync(`ffprobe -v quiet -print_format json -show_streams "${p}"`).toString();
  return parseFloat(JSON.parse(out).streams[0].duration);
}

// ── Q&A 세그먼트 시간 계산 (single-qa 전용) ───────────────────────────────────
function getQaSegmentTimes(qaN) {
  const silenceSec      = tsData.silence_sec ?? 1.5;
  const TRAILING_BUFFER = 0.3;
  const segAbsStarts    = [];
  let offset = 0;
  for (const seg of tsData.segments) {
    segAbsStarts.push(offset);
    const ends    = seg.alignment?.character_end_times_seconds ?? [];
    const lastEnd = ends.length > 0 ? ends[ends.length - 1] : 0;
    const effDur  = (seg.duration_sec > 0 && seg.duration_sec >= lastEnd - 0.05)
      ? seg.duration_sec
      : (lastEnd > 0 ? lastEnd + TRAILING_BUFFER : 0);
    offset += effDur + silenceSec;
  }
  // segments: [0]=QA인트로, [1]=Q1,[2]=A1, ..., [9]=Q5,[10]=A5, [11]=클로징
  const qIdx = 2 * qaN - 1;
  const aIdx = 2 * qaN;
  if (aIdx >= tsData.segments.length) {
    console.error(`❌ Q${qaN} 인덱스 범위 초과: segments.length=${tsData.segments.length}`);
    process.exit(1);
  }
  const clipStart = segAbsStarts[qIdx];
  const aSeg      = tsData.segments[aIdx];
  const aEnds     = aSeg.alignment?.character_end_times_seconds ?? [];
  const aLastEnd  = aEnds.length > 0 ? aEnds[aEnds.length - 1] : 0;
  const aEffDur   = (aSeg.duration_sec > 0 && aSeg.duration_sec >= aLastEnd - 0.05)
    ? aSeg.duration_sec
    : (aLastEnd > 0 ? aLastEnd + TRAILING_BUFFER : 0);
  const clipDur   = segAbsStarts[aIdx] + aEffDur - clipStart;
  const qSeg      = tsData.segments[qIdx];
  const aRelStart = segAbsStarts[aIdx] - clipStart;
  const allChars  = [
    ...(qSeg.alignment?.characters ?? []),
    ...(aSeg.alignment?.characters ?? []),
  ];
  const allStartTimes = [
    ...(qSeg.alignment?.character_start_times_seconds ?? []).map(t => t + 0),
    ...(aSeg.alignment?.character_start_times_seconds ?? []).map(t => t + aRelStart),
  ];
  const allEndTimes = [
    ...(qSeg.alignment?.character_end_times_seconds ?? []).map(t => t + 0),
    ...(aSeg.alignment?.character_end_times_seconds ?? []).map(t => t + aRelStart),
  ];
  return { clipStart, clipDur, allChars, allStartTimes, allEndTimes };
}

// ── 오디오 소스 결정 (single-qa 시 클리핑) ────────────────────────────────────
let activeMp3Path = mp3Path;
let qaClipTimes   = null;
if (SINGLE_QA !== null) {
  qaClipTimes = getQaSegmentTimes(SINGLE_QA);
  const clippedPath = path.join(CAPCUT_QA_DIR, `qa${SINGLE_QA}_clip.mp3`);
  console.log(`✂️  Q${SINGLE_QA} 클리핑: ${qaClipTimes.clipStart.toFixed(3)}s 부터 ${qaClipTimes.clipDur.toFixed(3)}s`);
  execSync(
    `ffmpeg -y -ss ${qaClipTimes.clipStart.toFixed(6)} -t ${qaClipTimes.clipDur.toFixed(6)} -i "${mp3Path}" -c copy "${clippedPath}"`,
    { stdio: 'pipe' }
  );
  activeMp3Path = clippedPath;
  console.log(`✅ 클리핑 완료`);
}

const qaDurSec = getMp3Duration(activeMp3Path);
const qaDurUs  = toUs(qaDurSec);
console.log(`🎵 Q&A 오디오: ${qaDurSec.toFixed(2)}s  (${(qaDurSec / 60).toFixed(1)}분)`);

// ── Shorts 이미지 파일 목록 ─────────────────────────────────────────────────
const imgFiles = fs.existsSync(IMAGE_SEARCH_DIR)
  ? fs.readdirSync(IMAGE_SEARCH_DIR).filter(f => f.match(/^QASC\d+\.png$/i)).sort()
  : [];

if (imgFiles.length === 0) {
  const hint = SINGLE_QA !== null
    ? `images_shorts/QA${SINGLE_QA}/QASC${String(SINGLE_QA).padStart(3, '0')}001.png`
    : 'images_shorts/QASC*.png';
  console.error(`❌ ${hint} 없음 — run_05b_images_shorts.mjs 먼저 실행`);
  process.exit(1);
}
console.log(`🖼️  Shorts 이미지: ${imgFiles.length}개`);

// ── 템플릿에서 정적 소재 추출 ─────────────────────────────────────────────────
const RETRO_FLICKER_EFFECT_ID = '7618619632592620805';
const _retroFlicker = tmats.video_effects.find(e => e.effect_id === RETRO_FLICKER_EFFECT_ID);
if (!_retroFlicker) {
  console.error('❌ 마스터 템플릿에 레트로 플리커 효과 없음');
  process.exit(1);
}

const T_VE = {
  RETRO_FLICKER: _retroFlicker,
  NOISE_OUT:   tmats.video_effects.find(e => e.effect_id === '7582441563750534453'),
  TAPE_80S:    tmats.video_effects.find(e => e.effect_id === '7414191309986090245'),
};
for (const [k, v] of Object.entries(T_VE)) {
  if (!v) { console.error(`❌ video_effect 없음: ${k}`); process.exit(1); }
}

const T_STICKER    = tmats.stickers[0];
const T_TRANSITION = tmats.transitions[0];
const T_HSL        = (tmats.hsl || [])[0];
const T_DENOISE    = (tmats.realtime_denoises || [])[0];
const HSL_PATH     = normPath(T_HSL?.path || '');
const HSL_LUMI     = normPath(T_HSL?.lumi_hub_path || '');
const DENOISE_PATH = normPath(T_DENOISE?.path || '');

// ── 상수 (Shorts 전용) ────────────────────────────────────────────────────────
const SCALE_MAX      = 1.15;
const SCALE_Y        = SCALE_MAX ** 2;
const UNIFORM_VAL    = 1 / SCALE_MAX;
const STK_SCALE      = 0.18;
const STK_X          = -1.30;
const STK_Y          = -0.68;
const TRANS_DURATION = 1_000_000;        // B 페이드 1.0s
const NOISE_OUT_DUR  = 2_000_000;        // 노이즈 아웃 2.0s
const TAPE_DUR       = toUs(1.93);       // 80년대 테이프 1.93s
const NOISE_CLIP_US  = 2_000_000;        // 라디오 노이즈 2.0s
const LEAD_DUR       = Math.max(TAPE_DUR, NOISE_CLIP_US);
const BREATHING_ROOM = 2_000_000;        // TTS 후 2초 여백
const TTS_VOL        = 0.5011872053146362;
const ZOOM_OUT_ANIM_ID   = '6798332584276267527';
const ZOOM_OUT_ANIM_PATH = 'C:/Users/채결사/AppData/Local/CapCut/User Data/Cache/effect/6798332584276267527/0c736f993d36a7b1ef00cc73d2ba656f';

// ── 타임라인 계산 ─────────────────────────────────────────────────────────────
// [라디오 노이즈 + 80s 테이프] → [Q&A TTS] → [2s 여백] → [Noise Out]
const sceneStart  = 0;
const ttsStart    = LEAD_DUR;
const ttsEnd      = ttsStart + qaDurUs;
const sceneEnd    = ttsEnd + BREATHING_ROOM;
const noiseOutStart = sceneEnd;
const TOTAL_US    = noiseOutStart + NOISE_OUT_DUR;

console.log(`\n📐 Shorts 타임라인:`);
console.log(`   노이즈 리드인: 0 ~ ${(LEAD_DUR/1e6).toFixed(2)}s`);
console.log(`   Q&A TTS:      ${(ttsStart/1e6).toFixed(2)}s ~ ${(ttsEnd/1e6).toFixed(2)}s`);
console.log(`   여백:         ${(ttsEnd/1e6).toFixed(2)}s ~ ${(sceneEnd/1e6).toFixed(2)}s`);
console.log(`   Noise Out:    ${(noiseOutStart/1e6).toFixed(2)}s ~ ${(TOTAL_US/1e6).toFixed(2)}s`);
console.log(`   총 재생:      ${(TOTAL_US/1e6).toFixed(2)}s`);

// ── 씬 duration 분배 (sentence boundary 기반) ─────────────────────────────────
const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '…']);
const sceneCount   = imgFiles.length;
const totalSceneDur = sceneEnd - sceneStart;  // 리드인 + TTS + 여백 전체

function calcShortsSceneDurations() {
  if (sceneCount === 1) return [totalSceneDur];

  const chars = tsData.segments.flatMap(s => s.alignment.characters);
  const ends  = tsData.segments.flatMap(s => s.alignment.character_end_times_seconds);

  const boundaryMs = new Set();
  for (let i = 0; i < chars.length - 1; i++) {
    if (SENTENCE_END.has(chars[i]) && ends[i] > 0 && ends[i] < qaDurSec) {
      boundaryMs.add(Math.round(ends[i] * 1000));
    }
  }
  const boundaries = [...boundaryMs].map(ms => ms / 1000).sort((a, b) => a - b);

  // TTS 구간 기준으로 경계 선택, 이후 리드인(LEAD_DUR)을 첫 씬에 흡수
  if (boundaries.length < sceneCount - 1) {
    console.warn(`  ⚠  유니크 경계 ${boundaries.length}개 < 씬-1 ${sceneCount - 1}개 → 균등분할`);
    const perUs = Math.round(totalSceneDur / sceneCount);
    const durs  = Array(sceneCount).fill(perUs);
    durs[durs.length - 1] += totalSceneDur - perUs * sceneCount;
    return durs;
  }

  const selected = [];
  for (let i = 1; i < sceneCount; i++) {
    const idealTime = (i / sceneCount) * qaDurSec;
    const minTime   = selected.length > 0 ? selected[selected.length - 1] + 0.05 : 0.05;
    let best = null, bestDist = Infinity;
    for (const b of boundaries) {
      if (b <= minTime) continue;
      const dist = Math.abs(b - idealTime);
      if (dist < bestDist) { bestDist = dist; best = b; }
    }
    if (best !== null) selected.push(best);
  }

  if (selected.length < sceneCount - 1) {
    console.warn(`  ⚠  선택 경계 ${selected.length}개 부족 → 균등분할`);
    const perUs = Math.round(totalSceneDur / sceneCount);
    const durs  = Array(sceneCount).fill(perUs);
    durs[durs.length - 1] += totalSceneDur - perUs * sceneCount;
    return durs;
  }

  // TTS 기준 경계 → 전체 씬 duration으로 변환 (첫 씬에 LEAD_DUR 흡수)
  const ttsBasedCuts = [0, ...selected, qaDurSec];
  const durs = [];
  for (let i = 0; i < sceneCount; i++) {
    let d = Math.round((ttsBasedCuts[i + 1] - ttsBasedCuts[i]) * 1_000_000);
    if (i === 0) d += LEAD_DUR;                            // 첫 씬: 리드인 흡수
    if (i === sceneCount - 1) d += BREATHING_ROOM;         // 마지막 씬: 여백 흡수
    durs.push(d);
  }
  const sum = durs.reduce((a, b) => a + b, 0);
  durs[durs.length - 1] += totalSceneDur - sum;
  return durs;
}

const sceneDurations = calcShortsSceneDurations();
console.log(`\n🎞  씬 타이밍: ${sceneDurations.map((d, i) => `SC${i+1}=${(d/1e6).toFixed(1)}s`).join(' | ')}`);

// ── 보조 소재 팩토리 (run_06 동일) ───────────────────────────────────────────
function makeVideoAuxRefs(segDurUs) {
  const speedId = newUUID(), phId = newUUID(), hslId = newUUID();
  const canvasId = newUUID(), trackingId = newUUID(), animId = newUUID();
  const scmId = newUUID(), colorId = newUUID(), loudId = newUUID(), vsId = newUUID();
  const zoomOutAnim = {
    id: ZOOM_OUT_ANIM_ID, type: 'in', start: 0, duration: segDurUs,
    path: ZOOM_OUT_ANIM_PATH, platform: 'all',
    resource_id: ZOOM_OUT_ANIM_ID, third_resource_id: ZOOM_OUT_ANIM_ID,
    source_platform: 1, name: '축소', category_id: 'in_fav', category_name: 'in_fav',
    panel: 'video', material_type: 'video', anim_adjust_params: null, request_id: '',
  };
  return {
    refs: [speedId, phId, hslId, canvasId, trackingId, animId, scmId, colorId, loudId, vsId],
    speeds:             [{ id: speedId, type: 'speed', mode: 0, speed: 1, curve_speed: null }],
    placeholder_infos:  [{ id: phId, type: 'placeholder_info', meta_type: 'none', res_path: '', res_text: '', error_path: '', error_text: '' }],
    hsl:                [{ id: hslId, constant_material_id: newUUID(), hsl_color_type: 1, hue: 0, saturation: 0, lightness: 0, interacting: true, version: '1', path: HSL_PATH, type: 'hsl', lumi_hub_path: HSL_LUMI, custom_color: '#FFE64444', resource_id: '', source_platform: 0 }],
    canvases:           [{ id: canvasId, type: 'none', color: '', blur: 0.0625, image: '', album_image: '', image_id: '', image_name: '', source_platform: 0, team_id: '' }],
    video_trackings:    [{ id: trackingId, type: 'video_tracking', result_path: '', map_path: '', config: { width: 0, height: 0, center_x: 0, center_y: 0, rotation: 0 }, version: '', tracker_type: 0, enable_scale: true, enable_relative_distance: true, tracking_time_range: 0, trackers: [], enable_video_tracking: false }],
    material_animations:[{ id: animId, type: 'sticker_animation', animations: [zoomOutAnim], multi_language_current: 'none' }],
    sound_channel_mappings: [{ id: scmId, type: '', audio_channel_mapping: 0, is_config_open: false }],
    material_colors:    [{ id: colorId, is_color_clip: false, is_gradient: false, solid_color: '', gradient_colors: [], gradient_percents: [], gradient_angle: 90, width: 0, height: 0 }],
    loudnesses:         [{ id: loudId }],
    vocal_separations:  [{ id: vsId, type: 'vocal_separation', choice: 0, removed_sounds: [], time_range: null, production_path: '', final_algorithm: '', enter_from: '' }],
  };
}

function makeAudioAuxRefs() {
  const speedId = newUUID(), phId = newUUID(), fadeId = newUUID();
  const beatsId = newUUID(), drId = newUUID(), scmId = newUUID(), vsId = newUUID();
  return {
    refs: [speedId, phId, fadeId, beatsId, drId, scmId, vsId],
    speeds:             [{ id: speedId, type: 'speed', mode: 0, speed: 1, curve_speed: null }],
    placeholder_infos:  [{ id: phId, type: 'placeholder_info', meta_type: 'none', res_path: '', res_text: '', error_path: '', error_text: '' }],
    audio_fades:        [{ id: fadeId, type: 'audio_fade', fade_type: 0, fade_in_duration: 0, fade_out_duration: 0 }],
    beats:              [{ id: beatsId, type: 'beats', enable_ai_beats: false, gear: 404, gear_count: 0, mode: 404, user_beats: [], user_delete_ai_beats: null, ai_beats: { melody_url: '', melody_path: '', beats_url: '', beats_path: '', melody_percents: [0], beat_speed_infos: [] } }],
    realtime_denoises:  [{ id: drId, type: 'realtime_denoise', is_denoise: false, denoise_mode: 1, denoise_rate: 0.85, path: DENOISE_PATH, sami_name: 'denoise_v2', sami_version: '1.0', sami_type: 2, is_from_hd_sounds: false }],
    sound_channel_mappings: [{ id: scmId, type: '', audio_channel_mapping: 0, is_config_open: false }],
    vocal_separations:  [{ id: vsId, type: 'vocal_separation', choice: 0, removed_sounds: [], time_range: null, production_path: '', final_algorithm: '', enter_from: '' }],
  };
}

function makeStickerAuxRefs() {
  const trackingId = newUUID();
  return {
    refs: [trackingId],
    video_trackings: [{ id: trackingId, type: 'video_tracking', result_path: '', map_path: '', config: { width: 0, height: 0, center_x: 0, center_y: 0, rotation: 0 }, version: '', tracker_type: 0, enable_scale: true, enable_relative_distance: true, tracking_time_range: 0, trackers: [], enable_video_tracking: false }],
  };
}

// ── 소재 누적기 ──────────────────────────────────────────────────────────────
const M = {
  videos: [], audios: [], stickers: [T_STICKER],
  canvases: [], transitions: [], audio_fades: [], beats: [],
  material_animations: [], placeholder_infos: [], speeds: [], chromas: (tmats.chromas || []).slice(),
  realtime_denoises: [], video_trackings: [], hsl: [],
  video_effects: [T_VE.RETRO_FLICKER, T_VE.NOISE_OUT, T_VE.TAPE_80S],
  sound_channel_mappings: [], material_colors: [], vocal_separations: [],
  texts: [], tail_leaders: [], images: [], texts_templates: [],
  audio_effects: [], audio_pannings: [], audio_pitch_shifts: [],
  hsl_curves: [], color_curves: [], primary_color_wheels: [],
  log_color_wheels: [], audio_balances: [], handwrites: [],
  manual_deformations: [], manual_beautys: [], plugin_effects: [],
  green_screens: [], shapes: [], material_colors_extra: [],
  digital_humans: [], digital_human_model_dressing: [], smart_crops: [],
  ai_translates: [], audio_track_indexes: [], loudnesses: [],
  vocal_beautifys: [], vocal_separations_extra: [], smart_relights: [],
  time_marks: [], multi_language_refs: [], video_shadows: [],
  video_strokes: [], video_radius: [], beats_extra: [], flowers: [], text_templates: [],
};

function addAux(aux) {
  for (const [k, arr] of Object.entries(aux)) {
    if (k === 'refs') continue;
    if (M[k]) M[k].push(...arr); else M[k] = arr.slice();
  }
}

// ── 세그먼트 팩토리 ──────────────────────────────────────────────────────────
function makeClip() {
  return { scale: { x: SCALE_MAX, y: SCALE_Y }, rotation: 0.0, transform: { x: 0.0, y: 0.0 }, flip: { vertical: false, horizontal: false }, alpha: 1.0 };
}

function makeVideoSegment({ materialId, start, dur, extraRefs, renderIndex }) {
  return {
    id: newUUID(),
    source_timerange: { start: 0, duration: dur },
    target_timerange: { start, duration: dur },
    render_timerange: { start: 0, duration: 0 },
    desc: '', state: 0, speed: 1,
    is_loop: false, is_tone_modify: false, reverse: false,
    intensifies_audio: false, cartoon: false,
    volume: 1, last_nonzero_volume: 1,
    clip: makeClip(),
    uniform_scale: { on: true, value: UNIFORM_VAL },
    material_id: materialId,
    extra_material_refs: extraRefs,
    render_index: renderIndex,
    keyframe_refs: [],
    enable_lut: true, enable_adjust: true, enable_hsl: true,
    visible: true, group_id: '',
    enable_color_curves: true, enable_hsl_curves: true,
    track_render_index: 1,
    hdr_settings: { mode: 1, intensity: 1, nits: 1000 },
    enable_color_wheels: true,
    track_attribute: 0, is_placeholder: false,
    template_id: '', enable_smart_color_adjust: false,
    template_scene: 'default',
    common_keyframes: [],
    caption_info: null,
    responsive_layout: { enable: false, target_follow: '', size_layout: 0, horizontal_pos_layout: 0, vertical_pos_layout: 0 },
    enable_color_match_adjust: false, enable_color_correct_adjust: false,
    enable_adjust_mask: false, raw_segment_id: '',
    lyric_keyframes: null, enable_video_mask: true,
    digital_human_template_group_id: '',
    color_correct_alg_result: '', source: 'segmentsourcenormal',
    enable_mask_stroke: false, enable_mask_shadow: false,
    enable_color_adjust_pro: false,
  };
}

function makeAudioSegment({ materialId, start, dur, srcStart = 0, srcDur, volume, extraRefs, trackRenderIndex = 0 }) {
  return {
    id: newUUID(),
    source_timerange: { start: srcStart, duration: srcDur },
    target_timerange: { start, duration: dur },
    render_timerange: { start: 0, duration: 0 },
    desc: '', state: 0, speed: 1,
    is_loop: false, is_tone_modify: false, reverse: false,
    intensifies_audio: false, cartoon: false,
    volume, last_nonzero_volume: 1,
    clip: null, uniform_scale: null,
    material_id: materialId,
    extra_material_refs: extraRefs,
    render_index: 0, keyframe_refs: [],
    enable_lut: false, enable_adjust: false, enable_hsl: false,
    visible: true, group_id: '',
    enable_color_curves: true, enable_hsl_curves: true,
    track_render_index: trackRenderIndex,
    hdr_settings: null, enable_color_wheels: true,
    track_attribute: 0, is_placeholder: false,
    template_id: '', enable_smart_color_adjust: false,
    template_scene: 'default',
    common_keyframes: [], caption_info: null,
    responsive_layout: { enable: false, target_follow: '', size_layout: 0, horizontal_pos_layout: 0, vertical_pos_layout: 0 },
    enable_color_match_adjust: false, enable_color_correct_adjust: false,
    enable_adjust_mask: false, raw_segment_id: '',
    lyric_keyframes: null, enable_video_mask: true,
    digital_human_template_group_id: '',
    color_correct_alg_result: '', source: 'segmentsourcenormal',
    enable_mask_stroke: false, enable_mask_shadow: false,
    enable_color_adjust_pro: false,
  };
}

function makeEffectSegment({ materialId, start, dur, trackRenderIndex = 11006 }) {
  return {
    id: newUUID(),
    source_timerange: null,
    target_timerange: { start, duration: dur },
    render_timerange: { start: 0, duration: 0 },
    desc: '', state: 0, speed: 1,
    is_loop: false, is_tone_modify: false, reverse: false,
    intensifies_audio: false, cartoon: false,
    volume: 1, last_nonzero_volume: 1,
    clip: null, uniform_scale: null,
    material_id: materialId,
    extra_material_refs: [],
    render_index: trackRenderIndex, keyframe_refs: [],
    enable_lut: false, enable_adjust: false, enable_hsl: false,
    visible: true, group_id: '',
    enable_color_curves: true, enable_hsl_curves: true,
    track_render_index: trackRenderIndex,
    hdr_settings: null, enable_color_wheels: true,
    track_attribute: 0, is_placeholder: false,
    template_id: '', enable_smart_color_adjust: false,
    template_scene: 'default',
    common_keyframes: [], caption_info: null,
    responsive_layout: { enable: false, target_follow: '', size_layout: 0, horizontal_pos_layout: 0, vertical_pos_layout: 0 },
    enable_color_match_adjust: false, enable_color_correct_adjust: false,
    enable_adjust_mask: false, raw_segment_id: '',
    lyric_keyframes: null, enable_video_mask: true,
    digital_human_template_group_id: '',
    color_correct_alg_result: '', source: 'segmentsourcenormal',
    enable_mask_stroke: false, enable_mask_shadow: false,
    enable_color_adjust_pro: false,
  };
}

function makeStickerSegment({ materialId, start, dur, extraRefs }) {
  return {
    id: newUUID(),
    source_timerange: null,
    target_timerange: { start, duration: dur },
    render_timerange: { start: 0, duration: 0 },
    desc: '', state: 0, speed: 1,
    is_loop: false, is_tone_modify: false, reverse: false,
    intensifies_audio: false, cartoon: false,
    volume: 1, last_nonzero_volume: 1,
    clip: {
      scale: { x: STK_SCALE, y: STK_SCALE },
      rotation: 0,
      transform: { x: STK_X, y: STK_Y },
      flip: { vertical: false, horizontal: false },
      alpha: 1,
    },
    uniform_scale: { on: true, value: 1 },
    material_id: materialId,
    extra_material_refs: extraRefs,
    render_index: 14001, keyframe_refs: [],
    enable_lut: false, enable_adjust: false, enable_hsl: false,
    visible: true, group_id: '',
    enable_color_curves: true, enable_hsl_curves: true,
    track_render_index: 2,
    hdr_settings: null, enable_color_wheels: true,
    track_attribute: 0, is_placeholder: false,
    template_id: '', enable_smart_color_adjust: false,
    template_scene: 'default',
    common_keyframes: [], caption_info: null,
    responsive_layout: { enable: false, target_follow: '', size_layout: 0, horizontal_pos_layout: 0, vertical_pos_layout: 0 },
    enable_color_match_adjust: false, enable_color_correct_adjust: false,
    enable_adjust_mask: false, raw_segment_id: '',
    lyric_keyframes: null, enable_video_mask: true,
    digital_human_template_group_id: '',
    color_correct_alg_result: '', source: 'segmentsourcenormal',
    enable_mask_stroke: false, enable_mask_shadow: false,
    enable_color_adjust_pro: false,
  };
}

// ── STEP 1: 비디오 세그먼트 빌드 ─────────────────────────────────────────────
console.log('\nSTEP 1: 비디오 세그먼트 빌드 중...');

const videoSegments = [];
let renderIdx = 100;
let pos = sceneStart;
let prevImgIdx = -1;

for (let i = 0; i < imgFiles.length; i++) {
  const fileName  = imgFiles[i];
  const imgPath   = path.resolve(IMAGE_SEARCH_DIR, fileName);
  if (!fs.existsSync(imgPath)) {
    console.error(`❌ 이미지 없음: ${imgPath}`);
    process.exit(1);
  }

  const dur = sceneDurations[i] ?? Math.round(totalSceneDur / imgFiles.length);
  const videoMat = {
    id: newUUID(), unique_id: '', type: 'photo',
    duration: 10800000000,
    path: normPath(imgPath), media_path: '', local_id: '',
    has_audio: false, reverse_path: '', intensifies_path: '',
    reverse_intensifies_path: '', intensifies_audio_path: '', cartoon_path: '',
    width: 1080, height: 1920,                     // ← 9:16 세로형
    category_id: '', category_name: 'local',
    material_id: '', material_name: fileName.replace('.png', ''), material_url: '',
    crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
    crop_ratio: 'free', audio_fade: null, crop_scale: 1, extra_type_option: 0,
    stable: { stable_level: 0, matrix_path: '', time_range: { start: 0, duration: 0 } },
    matting: { flag: 0, path: '', interactiveTime: [], has_use_quick_brush: false, strokes: [], has_use_quick_eraser: false, expansion: 0, feather: 0, reverse: false, custom_matting_id: '', enable_matting_stroke: false },
    source: 0, source_platform: 0, formula_id: '', check_flag: 0,
    video_algorithm: { algorithms: [], time_range: { start: 0, duration: 0 }, path: '', gameplay_configs: [], ai_in_painting_config: [], complement_frame_config: null, motion_blur_config: null, deflicker: null, noise_reduction: null, quality_enhance: null, super_resolution: null, ai_background_configs: [], smart_complement_frame: null, aigc_generate: null, aigc_generate_list: [], mouth_shape_driver: null, ai_expression_driven: null, ai_motion_driven: null, image_interpretation: null, story_video_modify_video_config: null, sr_enabled: false },
  };
  M.videos.push(videoMat);

  const aux = makeVideoAuxRefs(dur);
  addAux(aux);
  const extraRefs = [...aux.refs];

  // B 페이드: 씬 간 전환 (두 번째 씬부터)
  if (i > 0) {
    const tm = {
      id: newUUID(), type: 'transition',
      name: T_TRANSITION.name,
      effect_id: T_TRANSITION.effect_id,
      resource_id: T_TRANSITION.resource_id,
      third_resource_id: T_TRANSITION.third_resource_id || '',
      source_platform: T_TRANSITION.source_platform,
      path: T_TRANSITION.path,
      duration: TRANS_DURATION,
      is_overlap: T_TRANSITION.is_overlap,
      platform: T_TRANSITION.platform || '',
      category_id: T_TRANSITION.category_id || '',
      category_name: T_TRANSITION.category_name || '',
      request_id: '', is_ai_transition: false, video_path: '', task_id: '',
    };
    M.transitions.push(tm);
    extraRefs.push(tm.id);
  }

  videoSegments.push(makeVideoSegment({
    materialId:  videoMat.id,
    start:       pos,
    dur,
    extraRefs,
    renderIndex: renderIdx++,
  }));
  pos += dur;
}

console.log(`  비디오 세그먼트: ${videoSegments.length}개 / B 페이드: ${M.transitions.length}개`);

// ── STEP 2: 이펙트 + 스티커 빌드 ─────────────────────────────────────────────
console.log('\nSTEP 2: 이펙트 + 스티커 빌드 중...');

const effectSegs3 = [];  // Retro Flicker / Noise Out
const effectSegs4 = [];  // 80s Tape
const stickerSegs = [];

// 80s Tape: 시작에 배치
effectSegs4.push(makeEffectSegment({
  materialId: T_VE.TAPE_80S.id,
  start: sceneStart,
  dur: TAPE_DUR,
  trackRenderIndex: 11005,
}));

// 레트로 플리커 + WAVE 스티커: TTS 구간
effectSegs3.push(makeEffectSegment({
  materialId: T_VE.RETRO_FLICKER.id,
  start: ttsStart,
  dur: qaDurUs,
  trackRenderIndex: 11006,
}));
const stkAux = makeStickerAuxRefs(); addAux(stkAux);
stickerSegs.push(makeStickerSegment({
  materialId: T_STICKER.id,
  start: ttsStart,
  dur: qaDurUs,
  extraRefs: stkAux.refs,
}));

// Noise Out
effectSegs3.push(makeEffectSegment({
  materialId: T_VE.NOISE_OUT.id,
  start: noiseOutStart,
  dur: NOISE_OUT_DUR,
  trackRenderIndex: 11006,
}));

console.log(`  이펙트: ${effectSegs3.length + effectSegs4.length}개 / 스티커: ${stickerSegs.length}개`);

// ── STEP 3: 오디오 트랙 빌드 ──────────────────────────────────────────────────
console.log('\nSTEP 3: 오디오 트랙 빌드 중...');

function makeSoundMat(refMat, name, type = 'sound') {
  return {
    id: newUUID(), unique_id: '', type,
    name, duration: refMat.duration,
    path: normPath(refMat.path),
    category_name: '', wave_points: [], music_id: '',
    app_id: 1775, text_id: '', tone_type: '', source_platform: 0,
    video_id: '', effect_id: '', resource_id: '', third_resource_id: '',
    category_id: '0', intensifies_path: '', formula_id: '',
    check_flag: 1, team_id: '', local_material_id: '',
    tone_speaker: '', mock_tone_speaker: '', tone_effect_id: '', tone_effect_name: '',
    tone_platform: '', cloned_model_type: '', tone_category_id: '', tone_category_name: '',
    tone_second_category_id: '', tone_second_category_name: '',
    tone_emotion_name_key: '', tone_emotion_style: '', tone_emotion_role: '',
    tone_emotion_selection: '', tone_emotion_scale: 0, moyin_emotion: '',
    request_id: '', query: '', search_id: '', sound_separate_type: '',
    is_text_edit_overdub: false, is_ugc: false, is_ai_clone_tone: false,
    is_ai_clone_tone_post: false, source_from: '', copyright_limit_type: 'none',
    aigc_history_id: '', aigc_item_id: '', music_source: '', pgc_id: '', pgc_name: '',
    similiar_music_info: { original_song_id: '', original_song_name: '' },
    ai_music_type: 0, ai_music_enter_from: '', lyric_type: 0, tts_task_id: '',
    tts_generate_scene: '', ai_music_generate_scene: 0,
    tts_benefit_info: { benefit_type: 'none', benefit_log_id: '', benefit_log_extra: '', benefit_amount: -1 },
  };
}

// 라디오 노이즈 리드인
const noiseAux = makeAudioAuxRefs(); addAux(noiseAux);
const noiseMat = makeSoundMat(REF.radio_noise, 'Radio noise');
M.audios.push(noiseMat);
const fadedId = newUUID();
M.audio_fades.push({ id: fadedId, type: 'audio_fade', fade_type: 0, fade_in_duration: 300_000, fade_out_duration: 300_000 });
const radioNoiseSegs = [makeAudioSegment({
  materialId: noiseMat.id,
  start: sceneStart, dur: NOISE_CLIP_US,
  srcStart: 0, srcDur: NOISE_CLIP_US,
  volume: 1,
  extraRefs: [...noiseAux.refs, fadedId],
  trackRenderIndex: 5,
})];

// TTS
const ttsMat = {
  id: newUUID(), unique_id: '', type: 'music',
  name: path.basename(activeMp3Path), duration: qaDurUs,
  path: normPath(activeMp3Path),
  category_name: '', wave_points: [], music_id: '',
  app_id: 1775, text_id: '', tone_type: '', source_platform: 0,
  video_id: '', effect_id: '', resource_id: '', third_resource_id: '',
  category_id: '0', intensifies_path: '', formula_id: '',
  check_flag: 1, team_id: '', local_material_id: '',
  tone_speaker: '', mock_tone_speaker: '', tone_effect_id: '', tone_effect_name: '',
  tone_platform: '', cloned_model_type: '', tone_category_id: '', tone_category_name: '',
  tone_second_category_id: '', tone_second_category_name: '',
  tone_emotion_name_key: '', tone_emotion_style: '', tone_emotion_role: '',
  tone_emotion_selection: '', tone_emotion_scale: 0, moyin_emotion: '',
  request_id: '', query: '', search_id: '', sound_separate_type: '',
  is_text_edit_overdub: false, is_ugc: false, is_ai_clone_tone: false,
  is_ai_clone_tone_post: false, source_from: '', copyright_limit_type: 'none',
  aigc_history_id: '', aigc_item_id: '', music_source: '', pgc_id: '', pgc_name: '',
  similiar_music_info: { original_song_id: '', original_song_name: '' },
  ai_music_type: 0, ai_music_enter_from: '', lyric_type: 0, tts_task_id: '',
  tts_generate_scene: '', ai_music_generate_scene: 0,
  tts_benefit_info: { benefit_type: 'none', benefit_log_id: '', benefit_log_extra: '', benefit_amount: -1 },
};
const ttsAux = makeAudioAuxRefs(); addAux(ttsAux);
M.audios.push(ttsMat);
const ttsSeg = makeAudioSegment({
  materialId: ttsMat.id,
  start: ttsStart, dur: qaDurUs,
  srcStart: 0, srcDur: qaDurUs,
  volume: TTS_VOL, extraRefs: ttsAux.refs, trackRenderIndex: 8,
});

console.log(`  Radio noise: 1개 / TTS: 1개 (${qaDurSec.toFixed(2)}s)`);

// ── STEP 3.5: 자막 트랙 빌드 (--single-qa 모드) ───────────────────────────────
let subtitleResult = null;
if (SINGLE_QA !== null && qaClipTimes) {
  console.log('\nSTEP 3.5: 자막 트랙 빌드 중...');
  const baseStyle = loadTextStyle(tmats);
  const spans = buildSubtitles(qaClipTimes.allChars, qaClipTimes.allStartTimes, qaClipTimes.allEndTimes);
  subtitleResult = buildTextTrack(spans, ttsStart, baseStyle);
  M.texts.push(...subtitleResult.textMaterials);
  M.material_animations.push(...subtitleResult.matAnimations);
  console.log(`  자막 스팬: ${spans.length}개`);
}

// ── STEP 4: 트랙 조립 ────────────────────────────────────────────────────────
console.log('\nSTEP 4: 트랙 조립 중...');

function makeTrack(type, segments, opts = {}) {
  return {
    id: newUUID(), type, segments,
    flag: opts.flag ?? 0,
    attribute: opts.attribute ?? 0,
    name: opts.name ?? '',
    is_default_name: opts.is_default_name ?? true,
  };
}

const tracks = [
  makeTrack('video',   []),
  makeTrack('video',   videoSegments),
  makeTrack('sticker', stickerSegs),
  makeTrack('effect',  [...effectSegs3, ...effectSegs4]),
  makeTrack('audio',   radioNoiseSegs),
  makeTrack('audio',   [ttsSeg]),
  ...(subtitleResult ? [subtitleResult.track] : []),
];

// ── 출력 JSON 조립 ───────────────────────────────────────────────────────────
const materials = {
  flowers: [], videos: M.videos, tail_leaders: [], audios: M.audios,
  images: [], texts: [...(tmats.texts || []), ...M.texts], effects: (tmats.effects || []).slice(),
  stickers: M.stickers, canvases: M.canvases, transitions: M.transitions,
  audio_effects: tmats.audio_effects || [], audio_fades: M.audio_fades,
  beats: M.beats, material_animations: M.material_animations,
  placeholders: tmats.placeholders || [], placeholder_infos: M.placeholder_infos,
  speeds: M.speeds, common_mask: tmats.common_mask || [], chromas: M.chromas,
  text_templates: [], realtime_denoises: M.realtime_denoises,
  audio_pannings: tmats.audio_pannings || [], audio_pitch_shifts: tmats.audio_pitch_shifts || [],
  video_trackings: M.video_trackings, hsl: M.hsl, drafts: tmats.drafts || [],
  color_curves: tmats.color_curves || [], hsl_curves: tmats.hsl_curves || [],
  primary_color_wheels: tmats.primary_color_wheels || [],
  log_color_wheels: tmats.log_color_wheels || [],
  video_effects: M.video_effects, audio_balances: tmats.audio_balances || [],
  handwrites: [], manual_deformations: [], manual_beautys: [],
  plugin_effects: [], sound_channel_mappings: M.sound_channel_mappings,
  green_screens: [], shapes: [], material_colors: M.material_colors,
  digital_humans: [], digital_human_model_dressing: [], smart_crops: [],
  ai_translates: [], audio_track_indexes: tmats.audio_track_indexes || [],
  loudnesses: tmats.loudnesses || [], vocal_beautifys: tmats.vocal_beautifys || [],
  vocal_separations: M.vocal_separations, smart_relights: [],
  time_marks: tmats.time_marks || [], multi_language_refs: [], video_shadows: [],
  video_strokes: [], video_radius: [],
};

const newDraft = {
  id: template.id, version: template.version, new_version: template.new_version,
  name: template.name + '_shorts', duration: TOTAL_US,
  create_time: template.create_time, update_time: template.update_time,
  fps: template.fps, is_drop_frame_timecode: template.is_drop_frame_timecode,
  color_space: template.color_space, config: template.config,
  // ── Shorts 전용: 9:16 세로 캔버스 ──
  canvas_config: { ratio: '9:16', width: 1080, height: 1920, background: null },
  group_container: template.group_container,
  keyframes: template.keyframes, keyframe_graph_list: template.keyframe_graph_list,
  platform: template.platform, last_modified_platform: template.last_modified_platform,
  mutable_config: template.mutable_config, cover: template.cover,
  retouch_cover: template.retouch_cover, extra_info: template.extra_info,
  relationships: template.relationships || [],
  render_index_track_mode_on: template.render_index_track_mode_on,
  free_render_index_mode_on: template.free_render_index_mode_on,
  static_cover_image_path: template.static_cover_image_path,
  source: template.source, time_marks: template.time_marks,
  path: template.path, lyrics_effects: template.lyrics_effects || [],
  uneven_animation_template_info: template.uneven_animation_template_info,
  draft_type: template.draft_type, smart_ads_info: template.smart_ads_info,
  function_assistant_info: template.function_assistant_info,
  materials, tracks,
};

// ── CapCut 드래프트 폴더로 배송 ───────────────────────────────────────────────
{
  const DRAFTS_DIR = process.env.CAPCUT_DRAFTS_DIR;
  if (!DRAFTS_DIR || !fs.existsSync(DRAFTS_DIR)) {
    console.error('❌ CAPCUT_DRAFTS_DIR가 .env에 없거나 경로가 유효하지 않습니다.');
    process.exit(1);
  }

  const isYoutubeEp = /_youtube$/i.test(epId);
  const baseFolder  = isYoutubeEp
    ? epId.replace(/^ep_/i, 'EP_').replace(/_youtube$/i, '_youtube')
    : (() => {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `Radio_EP_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      })();
  const folderName = SINGLE_QA !== null ? `${baseFolder}_QA${SINGLE_QA}_shorts` : `${baseFolder}_shorts`;
  const targetDir  = path.join(DRAFTS_DIR, folderName);
  fs.mkdirSync(targetDir, { recursive: true });

  // 메타 템플릿
  const metaTemplatePath = path.join(P.masterTemplate, 'draft_meta_info.json');
  if (!fs.existsSync(metaTemplatePath)) {
    console.error('❌ master_template/draft_meta_info.json 없음');
    process.exit(1);
  }
  const epImagesUrl = normPath(IMAGE_SEARCH_DIR);
  const epAudioUrl  = normPath(SINGLE_QA !== null ? CAPCUT_QA_DIR : P.audio);
  const metaRaw = fs.readFileSync(metaTemplatePath, 'utf-8')
    .replace(/C:\/radio-dj-studio\/\.radio_output\/images\//g, `${epImagesUrl}/`)
    .replace(/C:\/radio-dj-studio\/\.radio_output\/audio\//g,  `${epAudioUrl}/`);
  const metaInfo = JSON.parse(metaRaw);

  const rootUUID = newUUID();
  metaInfo.id              = rootUUID;
  metaInfo.draft_id        = rootUUID;
  metaInfo.draft_name      = folderName;
  metaInfo.draft_fold_path = normPath(targetDir);
  newDraft.id = rootUUID;

  fs.writeFileSync(path.join(targetDir, 'draft_meta_info.json'), JSON.stringify(metaInfo, null, 2), 'utf-8');
  fs.writeFileSync(path.join(targetDir, 'draft_content.json'),   JSON.stringify(newDraft, null, 2), 'utf-8');

  // 중간 저장 (capcut_shorts/)
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(newDraft, null, 2), 'utf-8');

  // Shorts 폴더 경로 저장 (다른 도구에서 참조용)
  fs.writeFileSync(path.join(P.base, 'capcut_shorts_project_dir.txt'), normPath(targetDir), 'utf-8');

  console.log(`\n🚀 Shorts CapCut 드래프트 배송 완료`);
  console.log(`   폴더: ${normPath(targetDir)}`);
  console.log(`   총 재생: ${(TOTAL_US/1e6).toFixed(2)}s (${imgFiles.length}씬 × Q&A TTS)`);
  console.log(`   UUID:  ${rootUUID}`);
}

console.log('\n📱 Shorts 완성! CapCut에서 바로 확인하세요.');
