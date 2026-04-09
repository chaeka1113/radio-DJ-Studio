/**
 * run_06_capcut_builder.mjs  v2
 * CapCut 프로젝트 빌더 — timestamps 기반 씬 duration + anchor 기반 타임라인
 *
 * STEP 0  : 전제조건 확인
 * STEP 1  : timestamps.json → chunks 맵 + ffprobe duration
 * STEP 2  : anchor 계산 (chunk 위치)
 * STEP 3  : 씬 timeline 계산 (sentence boundary 기반 duration)
 * STEP 4  : 비디오 세그먼트 빌드 (Ken Burns: scale only)
 * STEP 5  : 이펙트 / 스티커 빌드 (EP_MAP story_end 기준)
 * STEP 6  : 오디오 트랙 빌드 (radio_noise / pc_click / bgm / TTS)
 * STEP 7  : 조립 + 검증 + 저장
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const newUUID    = () => randomUUID().toUpperCase();
const toUs       = (sec) => Math.round(sec * 1_000_000);
const normPath   = (p) => (p || '').replace(/\\/g, '/');

// ─── STEP 0: 전제조건 확인 ────────────────────────────────────────────────────

const refMatPath = path.join(__dirname, 'ref_capcut_materials.json');
if (!fs.existsSync(refMatPath)) {
  console.error('❌ ref_capcut_materials.json 없음');
  console.error('   먼저 실행: node .radio_output/run_00_extract_materials.mjs');
  process.exit(1);
}
const REF = JSON.parse(fs.readFileSync(refMatPath, 'utf-8'));

const audioDir = path.join(__dirname, 'audio');
const tsFiles  = fs.readdirSync(audioDir).filter(f => f.endsWith('_timestamps.json')).sort();
if (tsFiles.length === 0) {
  console.error('❌ audio/*_timestamps.json 없음 — run_07_audio.mjs 먼저 실행');
  process.exit(1);
}

const sbPath = path.join(__dirname, '04_storyboard.json');
if (!fs.existsSync(sbPath)) {
  console.error('❌ 04_storyboard.json 없음 — run_04_storyboard.mjs 먼저 실행');
  process.exit(1);
}

// ─── 템플릿 (정적 CapCut 메타데이터 소스) ────────────────────────────────────
const TEMPLATE_PATH = path.join(path.dirname(__dirname), 'draft_content.json');
if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error('❌ 프로젝트 루트 draft_content.json 없음 (템플릿 참조용)');
  process.exit(1);
}
const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf-8'));
const tmats    = template.materials;

// ─── 템플릿에서 정적 소재 추출 ────────────────────────────────────────────────
const T_STICKER    = tmats.stickers[0];
const T_VE = {
  BLACK_NOISE: tmats.video_effects.find(e => e.effect_id === '7399470796290166022'),
  NOISE_OUT:   tmats.video_effects.find(e => e.effect_id === '7582441563750534453'),
  WHITE_IN:    tmats.video_effects.find(e => e.effect_id === '7399466630230609157'),
  TAPE_80S:    tmats.video_effects.find(e => e.effect_id === '7414191309986090245'),
};
for (const [k, v] of Object.entries(T_VE)) {
  if (!v) { console.error(`❌ video_effect 없음: ${k} — draft_content.json를 갱신하세요`); process.exit(1); }
}
const T_TRANSITION = tmats.transitions[0];
const T_HSL        = (tmats.hsl || [])[0];
const T_DENOISE    = (tmats.realtime_denoises || [])[0];
const HSL_PATH     = normPath(T_HSL?.path || '');
const HSL_LUMI     = normPath(T_HSL?.lumi_hub_path || '');
const DENOISE_PATH = normPath(T_DENOISE?.path || '');

// ─── 상수 ─────────────────────────────────────────────────────────────────────
const IMAGE_DIR  = path.join(__dirname, 'images');
const OUTPUT_DIR = path.join(__dirname, 'capcut_output');
const OUTPUT_PATH= path.join(OUTPUT_DIR, 'draft_content.json');

const SCALE_MAX        = 1.15;
const SCALE_Y          = SCALE_MAX ** 2;          // 1.3225
const UNIFORM_VAL      = 1 / SCALE_MAX;           // 0.8695...
const KF_T0            = 0.050;
const KF_T1            = 0.962;
const TRANS_DURATION   = 1_000_000;               // B 페이드 1.0s
const NOISE_OUT_DUR    = 2_000_000;               // 노이즈 아웃 2.0s
const WHITE_IN_DUR     = 2_300_000;               // 화이트 인 2.3s
const TAPE_DUR         = toUs(1.93);              // 80년대 테이프 1.93s
const BGM_VOL          = 0.05011872947216034;
const TTS_VOL          = 0.5011872053146362;
const SENTENCE_END     = new Set(['。', '！', '？', '!', '?', '…']);

// ─── 유틸: ffprobe duration ───────────────────────────────────────────────────
function getMp3Duration(mp3Path) {
  const out = execSync(
    `ffprobe -v quiet -print_format json -show_streams "${mp3Path}"`
  ).toString();
  return parseFloat(JSON.parse(out).streams[0].duration);
}

// ─── STEP 1: timestamps.json → chunks 맵 ─────────────────────────────────────
console.log('\nSTEP 1: chunks 맵 구성 중...');
const chunks = {};

for (const fname of tsFiles) {
  const raw     = JSON.parse(fs.readFileSync(path.join(audioDir, fname), 'utf-8'));
  const chunkId = raw.chunk_id;
  const m       = chunkId.match(/^(\d+)_(?:ep(\d+)_)?(.+)$/);
  if (!m) { console.error(`chunk_id 파싱 실패: ${chunkId}`); process.exit(1); }

  const mp3Path = path.join(audioDir, chunkId + '.mp3');
  if (!fs.existsSync(mp3Path)) {
    console.error(`❌ MP3 없음: ${mp3Path}`); process.exit(1);
  }

  const durSec = getMp3Duration(mp3Path);
  chunks[chunkId] = {
    chunkId,
    idx:      parseInt(m[1]),
    ep:       m[2] ? parseInt(m[2]) : null,
    type:     m[3],
    mp3Path,
    segments: raw.segments,
    durSec,
    durUs:    toUs(durSec),
  };
}

const orderedChunks = Object.values(chunks).sort((a, b) => a.idx - b.idx);
console.log(`  ${orderedChunks.length}개 chunk: ${orderedChunks.map(c => c.chunkId).join(', ')}`);

// ─── STEP 2: anchor 계산 ──────────────────────────────────────────────────────
console.log('\nSTEP 2: anchor 계산 중...');

const PC_CLICK_US = toUs(REF.pc_click.durationSec);

const anchors = {};
let cursor = 0;

for (const chunk of orderedChunks) {
  let segStart;
  const durUs = chunk.durUs;

  if (chunk.type === 'opening') {
    segStart = 0;
  } else if (chunk.type === 'story' && chunk.ep === 1) {
    segStart = cursor + PC_CLICK_US;
  } else if (chunk.type === 'dj') {
    segStart = cursor + 10_000_000;
  } else if (chunk.type === 'story' && chunk.ep > 1) {
    segStart = cursor + PC_CLICK_US;
  } else {
    segStart = cursor; // qa_and_closing 등
  }

  anchors[chunk.chunkId] = { start: segStart, end: segStart + durUs, durUs };
  cursor = segStart + durUs;
}

const TOTAL_US = cursor;

// EP별 앵커 맵
const EP_MAP = {};
for (const chunk of orderedChunks) {
  if (!chunk.ep) continue;
  if (!EP_MAP[chunk.ep]) EP_MAP[chunk.ep] = {};
  EP_MAP[chunk.ep][chunk.type + '_start'] = anchors[chunk.chunkId].start;
  EP_MAP[chunk.ep][chunk.type + '_end']   = anchors[chunk.chunkId].end;
}

// ─── STEP 3: 씬 timeline (sentence boundary 기반 duration) ───────────────────
console.log('\nSTEP 3: 씬 타임라인 계산 중...');

function calcSceneDurations(chunkId, sceneCount) {
  const chunk   = chunks[chunkId];
  const totalUs = chunk.durUs;

  if (sceneCount === 0) return [];
  if (sceneCount === 1) return [totalUs];

  const chars = chunk.segments.flatMap(s => s.alignment.characters);
  const ends  = chunk.segments.flatMap(s => s.alignment.character_end_times_seconds);

  const boundaries = [];
  for (let i = 0; i < chars.length - 1; i++) {
    if (SENTENCE_END.has(chars[i])) boundaries.push(ends[i]);
  }
  boundaries.push(chunk.durSec);

  if (boundaries.length < sceneCount) {
    console.warn(`  ⚠  ${chunkId}: 문장경계 ${boundaries.length}개 < 씬 수 ${sceneCount}개 → 균등분할`);
    const perUs = Math.round(totalUs / sceneCount);
    const durs  = Array(sceneCount).fill(perUs);
    durs[durs.length - 1] += totalUs - perUs * sceneCount;
    return durs;
  }

  const step      = boundaries.length / sceneCount;
  const cutPoints = [0];
  for (let i = 1; i < sceneCount; i++) {
    const bIdx = Math.min(Math.round(i * step) - 1, boundaries.length - 1);
    cutPoints.push(boundaries[bIdx]);
  }
  cutPoints.push(chunk.durSec);

  const durs = [];
  for (let i = 0; i < sceneCount; i++) {
    durs.push(Math.round((cutPoints[i + 1] - cutPoints[i]) * 1_000_000));
  }
  const sum = durs.reduce((a, b) => a + b, 0);
  durs[durs.length - 1] += totalUs - sum;
  return durs;
}

// 스토리보드 씬을 그룹화 (episode_id 기준)
const storyboard = JSON.parse(fs.readFileSync(sbPath, 'utf-8'));
const sbScenes   = storyboard.scenes;

const sceneGroups = [];
let cg = null;
for (const s of sbScenes) {
  const isDJ  = s.type === 'DJ_SHOT';
  const epKey = isDJ ? null : (s.episode_id || null);
  const gKey  = isDJ ? 'dj_' + sceneGroups.length : 'ep' + epKey;
  if (!cg || cg._key !== gKey) {
    if (cg) sceneGroups.push(cg);
    cg = { _key: gKey, isDJ, scenes: [s] };
  } else {
    cg.scenes.push(s);
  }
}
if (cg) sceneGroups.push(cg);

// 씬 그룹을 chunk에 매핑 (07_qa_and_closing은 씬 없음)
const videoChunks = orderedChunks.filter(c => c.type !== 'qa_and_closing');
if (videoChunks.length !== sceneGroups.length) {
  console.warn(`  ⚠  videoChunks(${videoChunks.length}) ≠ sceneGroups(${sceneGroups.length})`);
}

const sceneTimeline = [];
sceneGroups.forEach((group, gi) => {
  const chunk      = videoChunks[gi];
  const anchorSt   = anchors[chunk.chunkId].start;
  const sceneDurs  = calcSceneDurations(chunk.chunkId, group.scenes.length);
  let pos = anchorSt;
  group.scenes.forEach((scene, si) => {
    const dur = sceneDurs[si];
    sceneTimeline.push({ ...scene, _chunk: chunk.chunkId, _start: pos, _dur: dur, _end: pos + dur });
    pos += dur;
  });
});

console.log(`  총 씬: ${sceneTimeline.length}개 / 총 재생: ${(TOTAL_US/1e6).toFixed(2)}s`);

// ─── 보조 소재 팩토리 ──────────────────────────────────────────────────────────
function makeVideoAuxRefs() {
  const speedId   = newUUID(), phId   = newUUID(), hslId    = newUUID();
  const canvasId  = newUUID(), animId = newUUID(), scmId    = newUUID();
  const colorId   = newUUID(), vsId   = newUUID();
  return {
    refs: [speedId, phId, hslId, canvasId, animId, scmId, colorId, vsId],
    speeds:             [{ id: speedId, type: 'speed', mode: 0, speed: 1, curve_speed: null }],
    placeholder_infos:  [{ id: phId, type: 'placeholder_info', meta_type: 'none', res_path: '', res_text: '', error_path: '', error_text: '' }],
    hsl:                [{ id: hslId, constant_material_id: newUUID(), hsl_color_type: 1, hue: 0, saturation: 0, lightness: 0, interacting: true, version: '1', path: HSL_PATH, type: 'hsl', lumi_hub_path: HSL_LUMI, custom_color: '#FFE64444', resource_id: '', source_platform: 0 }],
    canvases:           [{ id: canvasId, type: 'none', color: '', blur: 0.0625, image: '', album_image: '', image_id: '', image_name: '', source_platform: 0, team_id: '' }],
    material_animations:[{ id: animId, type: 'sticker_animation', animations: [], multi_language_current: 'none' }],
    sound_channel_mappings: [{ id: scmId, type: '', audio_channel_mapping: 0, is_config_open: false }],
    material_colors:    [{ id: colorId, is_color_clip: false, is_gradient: false, solid_color: '', gradient_colors: [], gradient_percents: [], gradient_angle: 90, width: 0, height: 0 }],
    vocal_separations:  [{ id: vsId, type: 'vocal_separation', choice: 0, removed_sounds: [], time_range: null, production_path: '', final_algorithm: '', enter_from: '' }],
  };
}

function makeAudioAuxRefs(fadeIn = 0, fadeOut = 0) {
  const speedId = newUUID(), phId = newUUID(), fadeId = newUUID();
  const beatsId = newUUID(), drId = newUUID(), scmId  = newUUID(), vsId = newUUID();
  return {
    refs: [speedId, phId, fadeId, beatsId, drId, scmId, vsId],
    speeds:             [{ id: speedId, type: 'speed', mode: 0, speed: 1, curve_speed: null }],
    placeholder_infos:  [{ id: phId, type: 'placeholder_info', meta_type: 'none', res_path: '', res_text: '', error_path: '', error_text: '' }],
    audio_fades:        [{ id: fadeId, type: 'audio_fade', fade_type: 0, fade_in_duration: fadeIn, fade_out_duration: fadeOut }],
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

// ─── 소재 누적기 ──────────────────────────────────────────────────────────────
const M = {
  videos: [], audios: [], stickers: [T_STICKER],
  canvases: [], transitions: [], audio_fades: [], beats: [],
  material_animations: [], placeholder_infos: [], speeds: [], chromas: (tmats.chromas || []).slice(),
  realtime_denoises: [], video_trackings: [], hsl: [],
  // video_effects: 중복 없이 4종만
  video_effects: [T_VE.BLACK_NOISE, T_VE.NOISE_OUT, T_VE.WHITE_IN, T_VE.TAPE_80S],
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

// ─── 세그먼트 팩토리 ──────────────────────────────────────────────────────────
function buildScaleKeyframes(segDurUs) {
  const t0 = Math.round(segDurUs * KF_T0);
  const t1 = Math.round(segDurUs * KF_T1);
  const kf  = (t, v) => ({ id: newUUID(), curveType: 'Line', time_offset: t, left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 }, values: [v], string_value: '', graphID: '' });
  return [
    { id: newUUID(), material_id: '', property_type: 'KFTypeScaleX', keyframe_list: [kf(t0, 1.0), kf(t1, SCALE_MAX)] },
    { id: newUUID(), material_id: '', property_type: 'KFTypeScaleY', keyframe_list: [kf(t0, 1.0), kf(t1, SCALE_MAX)] },
  ];
}

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
    common_keyframes: buildScaleKeyframes(dur),
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
      scale: { x: 0.3622848076999904, y: 0.3622848076999904 },
      rotation: 0,
      transform: { x: -0.8591114700620858, y: 0.7420398106612951 },
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

// ─── STEP 4: 비디오 세그먼트 빌드 ────────────────────────────────────────────
console.log('\nSTEP 4: 비디오 세그먼트 빌드 중...');

const videoSegments  = [];
const transitionMats = [];
let   renderIdx      = 100;
let   prevScene      = null;

function makeTransitionMat() {
  return {
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
}

function makeVideoMat(sceneId) {
  const imgPath = normPath(path.join(IMAGE_DIR, `${sceneId}.png`));
  return {
    id: newUUID(), unique_id: '', type: 'photo',
    duration: 10800000000,
    path: imgPath, media_path: '', local_id: '',
    has_audio: false, reverse_path: '', intensifies_path: '',
    reverse_intensifies_path: '', intensifies_audio_path: '', cartoon_path: '',
    width: 1408, height: 768,
    category_id: '', category_name: 'local',
    material_id: '', material_name: `${sceneId}.png`, material_url: '',
    crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
    crop_ratio: 'free', audio_fade: null, crop_scale: 1, extra_type_option: 0,
    stable: { stable_level: 0, matrix_path: '', time_range: { start: 0, duration: 0 } },
    matting: { flag: 0, path: '', interactiveTime: [], has_use_quick_brush: false, strokes: [], has_use_quick_eraser: false, expansion: 0, feather: 0, reverse: false, custom_matting_id: '', enable_matting_stroke: false },
    source: 0, source_platform: 0, formula_id: '', check_flag: 62978047,
    video_algorithm: { algorithms: [], time_range: { start: 0, duration: 0 }, path: '', gameplay_configs: [], ai_in_painting_config: [], complement_frame_config: null, motion_blur_config: null, deflicker: null, noise_reduction: null, quality_enhance: null, super_resolution: null, ai_background_configs: [], smart_complement_frame: null, aigc_generate: null, aigc_generate_list: [], mouth_shape_driver: null, ai_expression_driven: null, ai_motion_driven: null, image_interpretation: null, story_video_modify_video_config: null, sr_enabled: false },
  };
}

sceneTimeline.forEach((scene, i) => {
  const videoMat = makeVideoMat(scene.scene_id);
  M.videos.push(videoMat);

  const aux      = makeVideoAuxRefs();
  addAux(aux);

  const isStory    = scene.type !== 'DJ_SHOT';
  const prevStory  = prevScene && prevScene.type !== 'DJ_SHOT';
  const extraRefs  = [...aux.refs];

  // B 페이드: 사연→사연 구간만 (같은 chunk 내)
  if (isStory && prevStory && scene._chunk === prevScene._chunk) {
    const tm = makeTransitionMat();
    transitionMats.push(tm);
    extraRefs.push(tm.id);
  }

  videoSegments.push(makeVideoSegment({
    materialId:  videoMat.id,
    start:       scene._start,
    dur:         scene._dur,
    extraRefs,
    renderIndex: renderIdx++,
  }));
  prevScene = scene;
});

M.transitions.push(...transitionMats);
console.log(`  비디오 세그먼트: ${videoSegments.length}개 / B 페이드: ${transitionMats.length}개`);

// ─── STEP 5: 이펙트 + 스티커 빌드 (EP_MAP 기준) ───────────────────────────────
console.log('\nSTEP 5: 이펙트 + 스티커 빌드 중...');

const effectSegs3 = [];  // 블랙노이즈 / 노이즈아웃 / 화이트인
const effectSegs4 = [];  // 80년대 테이프
const stickerSegs = [];

const openingEnd = anchors['00_opening']?.end ?? 0;

// 오프닝 구간 스티커 + TAPE_80S
const opStkAux = makeStickerAuxRefs(); addAux(opStkAux);
stickerSegs.push(makeStickerSegment({ materialId: T_STICKER.id, start: 0, dur: openingEnd, extraRefs: opStkAux.refs }));
effectSegs4.push(makeEffectSegment({ materialId: T_VE.TAPE_80S.id, start: 0, dur: PC_CLICK_US + 200_000, trackRenderIndex: 11005 }));

// 각 EP 경계: story_end - 10s 기준
for (const [epStr, ep] of Object.entries(EP_MAP).sort()) {
  if (!ep.story_end) continue;

  const blackStart = ep.story_end - 10_000_000;
  const blackEnd   = ep.story_end;
  const noiseEnd   = blackEnd   + NOISE_OUT_DUR;
  const whiteEnd   = noiseEnd   + WHITE_IN_DUR;

  effectSegs3.push(makeEffectSegment({ materialId: T_VE.BLACK_NOISE.id, start: blackStart, dur: 10_000_000,  trackRenderIndex: 11006 }));
  effectSegs3.push(makeEffectSegment({ materialId: T_VE.NOISE_OUT.id,   start: blackEnd,   dur: NOISE_OUT_DUR, trackRenderIndex: 11006 }));
  effectSegs3.push(makeEffectSegment({ materialId: T_VE.WHITE_IN.id,    start: noiseEnd,   dur: WHITE_IN_DUR,  trackRenderIndex: 11006 }));
  effectSegs4.push(makeEffectSegment({ materialId: T_VE.TAPE_80S.id,    start: blackStart, dur: TAPE_DUR,      trackRenderIndex: 11005 }));

  const stkAux = makeStickerAuxRefs(); addAux(stkAux);
  stickerSegs.push(makeStickerSegment({ materialId: T_STICKER.id, start: blackStart, dur: 10_000_000, extraRefs: stkAux.refs }));
}

console.log(`  이펙트: ${effectSegs3.length + effectSegs4.length}개 / 스티커: ${stickerSegs.length}개`);

// ─── STEP 6: 오디오 트랙 빌드 ─────────────────────────────────────────────────
console.log('\nSTEP 6: 오디오 트랙 빌드 중...');

// 공통 오디오 material 팩토리
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

// ── 트랙5: Radio noise (DJ 씬 경계 앞뒤 2s) ──
const radioNoiseSegs = [];
const NOISE_CLIP_US  = 2_000_000;

sceneTimeline.filter(s => s.type === 'DJ_SHOT').forEach(ds => {
  const matIn  = makeSoundMat(REF.radio_noise, 'Radio noise');
  const auxIn  = makeAudioAuxRefs();
  addAux(auxIn);
  M.audios.push(matIn);
  const inDur = Math.min(NOISE_CLIP_US, ds._dur);
  radioNoiseSegs.push(makeAudioSegment({ materialId: matIn.id, start: ds._start, dur: inDur, srcStart: 0, srcDur: inDur, volume: 1, extraRefs: auxIn.refs, trackRenderIndex: 5 }));

  if (ds._dur > NOISE_CLIP_US * 2) {
    const matOut = makeSoundMat(REF.radio_noise, 'Radio noise');
    const auxOut = makeAudioAuxRefs();
    addAux(auxOut);
    M.audios.push(matOut);
    const outStart = ds._end - NOISE_CLIP_US;
    radioNoiseSegs.push(makeAudioSegment({ materialId: matOut.id, start: outStart, dur: NOISE_CLIP_US, srcStart: 0, srcDur: NOISE_CLIP_US, volume: 1, extraRefs: auxOut.refs, trackRenderIndex: 5 }));
  }
});

// ── 트랙6: PC click (오프닝 끝 + 각 DJ 끝 직후) ──
const pcClickSegs = [];

const pcClickPositions = [openingEnd];
for (const ep of Object.values(EP_MAP)) {
  if (ep.dj_end) pcClickPositions.push(ep.dj_end);
}

pcClickPositions.forEach(pos => {
  const mat = makeSoundMat(REF.pc_click, 'PC click');
  const aux = makeAudioAuxRefs();
  addAux(aux);
  M.audios.push(mat);
  pcClickSegs.push(makeAudioSegment({ materialId: mat.id, start: pos, dur: PC_CLICK_US, srcStart: 0, srcDur: PC_CLICK_US, volume: 1, extraRefs: aux.refs, trackRenderIndex: 6 }));
});

// ── 트랙7: BGM (각 사연 구간, 루핑) ──
const bgmSegs = [];
const BGM_MAT_DUR = REF.bgm.duration;

for (const ep of Object.values(EP_MAP)) {
  if (!ep.story_start || !ep.story_end) continue;
  let segStart  = ep.story_start;
  let remaining = ep.story_end - ep.story_start;
  let loopIdx   = 0;

  while (remaining > 0) {
    const clipDur = Math.min(remaining, BGM_MAT_DUR);
    const isFirst = loopIdx === 0;
    const fadeIn  = isFirst ? 1_833_333 : 299_999;
    const fadeOut = remaining <= BGM_MAT_DUR ? (isFirst ? 233_333 : 966_666) : 0;

    const mat = makeSoundMat(REF.bgm, 'BGM', 'music');
    const aux = makeAudioAuxRefs(fadeIn, fadeOut);
    addAux(aux);
    M.audios.push(mat);
    bgmSegs.push(makeAudioSegment({ materialId: mat.id, start: segStart, dur: clipDur, srcStart: 0, srcDur: clipDur, volume: BGM_VOL, extraRefs: aux.refs, trackRenderIndex: 7 }));

    segStart  += clipDur;
    remaining -= clipDur;
    loopIdx++;
  }
}

// ── 트랙8~: TTS (각 chunk 앵커 기준) ──
const ttsSegs  = [];
const ttsMats  = [];

orderedChunks.forEach((chunk, ti) => {
  const anchor = anchors[chunk.chunkId];
  const filePath = normPath(chunk.mp3Path);
  const mat = {
    id: newUUID(), unique_id: '', type: 'extract_music',
    name: path.basename(chunk.mp3Path), duration: chunk.durUs,
    path: filePath, category_name: '', wave_points: [], music_id: '',
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
  const aux = makeAudioAuxRefs();
  addAux(aux);
  ttsMats.push(mat);
  ttsSegs.push(makeAudioSegment({ materialId: mat.id, start: anchor.start, dur: chunk.durUs, srcStart: 0, srcDur: chunk.durUs, volume: TTS_VOL, extraRefs: aux.refs, trackRenderIndex: 8 + ti }));
  console.log(`  TTS [${ti+1}/${orderedChunks.length}] ${chunk.chunkId}: t=${(anchor.start/1e6).toFixed(2)}s dur=${chunk.durSec.toFixed(2)}s`);
});
M.audios.push(...ttsMats);

console.log(`  Radio noise: ${radioNoiseSegs.length}개 / PC click: ${pcClickSegs.length}개 / BGM: ${bgmSegs.length}개 / TTS: ${ttsSegs.length}개`);

// ─── STEP 7: 트랙 조립 ───────────────────────────────────────────────────────
console.log('\nSTEP 7: 트랙 조립 중...');

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
  makeTrack('video',   []),                                            // 0: 빈 비디오 (호환)
  makeTrack('video',   videoSegments),                                 // 1: 메인 이미지
  makeTrack('sticker', stickerSegs),                                   // 2: 스티커
  makeTrack('effect',  [...effectSegs3, ...effectSegs4]),              // 3: 레트로 이펙트
  makeTrack('audio',   radioNoiseSegs),                                // 4: Radio noise
  makeTrack('audio',   pcClickSegs),                                   // 5: PC click
  makeTrack('audio',   bgmSegs),                                       // 6: BGM
  ...ttsSegs.map(seg => makeTrack('audio', [seg])),                    // 7~: TTS
];

// ─── 검증 ─────────────────────────────────────────────────────────────────────
function validate(draft) {
  const errors = [];
  const videoSegs = draft.tracks.filter(t => t.type === 'video').flatMap(t => t.segments);

  for (const s of videoSegs) {
    if (Math.abs(s.clip.scale.x - SCALE_MAX) > 0.001)
      errors.push(`[${s.id.slice(0,8)}] clip.scale.x=${s.clip.scale.x}`);
  }
  for (const s of videoSegs) {
    for (const kf of s.common_keyframes || []) {
      if (kf.property_type && kf.property_type.includes('Position'))
        errors.push(`[${s.id.slice(0,8)}] Position KF 존재 금지`);
    }
  }
  for (const s of videoSegs) {
    const dur = s.target_timerange.duration;
    for (const kf of s.common_keyframes || []) {
      if (kf.property_type === 'KFTypeScaleX') {
        const r0 = kf.keyframe_list[0].time_offset / dur;
        const r1 = kf.keyframe_list[1].time_offset / dur;
        if (Math.abs(r0 - KF_T0) > 0.003) errors.push(`[${s.id.slice(0,8)}] KF_T0 비율 이상: ${r0.toFixed(4)}`);
        if (Math.abs(r1 - KF_T1) > 0.003) errors.push(`[${s.id.slice(0,8)}] KF_T1 비율 이상: ${r1.toFixed(4)}`);
      }
    }
  }
  if (draft.duration !== TOTAL_US)
    errors.push(`draft.duration 불일치: ${draft.duration} ≠ ${TOTAL_US}`);

  if (errors.length > 0) {
    console.error('\n❌ 검증 실패:');
    errors.forEach(e => console.error('   ' + e));
    process.exit(1);
  }
}

// ─── 출력 JSON 조립 ───────────────────────────────────────────────────────────
const materials = {
  flowers: [], videos: M.videos, tail_leaders: [], audios: M.audios,
  images: [], texts: (tmats.texts || []).slice(), effects: (tmats.effects || []).slice(),
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
  name: template.name, duration: TOTAL_US,
  create_time: template.create_time, update_time: template.update_time,
  fps: template.fps, is_drop_frame_timecode: template.is_drop_frame_timecode,
  color_space: template.color_space, config: template.config,
  canvas_config: template.canvas_config, group_container: template.group_container,
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

// 검증
validate(newDraft);

// ─── 저장 ─────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(newDraft, null, 2), 'utf-8');

// ─── テンキ爺 보고 ────────────────────────────────────────────────────────────
console.log('\nフン...今回こそちゃんとできたか確認してやろう。');
console.log('✅ 検証通過\n');
console.log('  [앵커별 타이밍]');
for (const [cid, a] of Object.entries(anchors)) {
  console.log(`  ${cid.padEnd(26)}: ${(a.start/1e6).toFixed(2)}s ~ ${(a.end/1e6).toFixed(2)}s  (${(a.durUs/1e6).toFixed(2)}s)`);
}
console.log(`\n  총 씬 수   : ${videoSegments.length}개`);
console.log(`  총 재생시간 : ${(TOTAL_US/1e6).toFixed(2)}s`);
console.log(`  총 트랙    : ${tracks.length}개`);
console.log(`\n📁 출력: ${OUTPUT_PATH}`);
console.log('\n文句があるなら直接言ってこい、ポンコツどもが。');
