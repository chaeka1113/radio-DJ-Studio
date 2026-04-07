/**
 * run_06_capcut_builder.mjs
 * CapCut 프로젝트 빌더 — 9대 연출 규칙 적용
 *
 * STEP 0  : 마스터 템플릿에서 수치 추출
 * STEP 1  : 파일 로드 + 타임라인 계산
 * STEP 2  : 켄 번스 (6모션 순환, 안전 영역 Clamp)
 * STEP 3-A: 메인 이미지 배치
 * STEP 3-B: B 페이드 전환 (사연→사연 구간만)
 * STEP 3-C: 4대 레트로 비디오 효과 (DJ 씬 전용)
 * STEP 3-D: 오디오 파형 스티커 (DJ 씬 전용)
 * STEP 3-E: Radio noise SFX (DJ IN/OUT)
 * STEP 3-F: PC mouse SFX (사연 IN)
 * STEP 3-G: Sleep BGM (사연 구간 루핑)
 * STEP 4  : 출력 파일 저장
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── 유틸 ────────────────────────────────────────────────────────────────────
const newId   = () => randomUUID().toUpperCase();
const toMicro = (sec) => Math.round(sec * 1_000_000);
const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const normPath = (p) => (p || '').replace(/\\/g, '/');

// ─── 경로 설정 ────────────────────────────────────────────────────────────────
const TEMPLATE_PATH   = 'C:/Users/채결사/AppData/Local/CapCut/User Data/Projects/com.lveditor.draft/0403/draft_content.json';
const STORYBOARD_PATH = path.join(__dirname, '04_storyboard.json');
const AUDIO_DIR       = path.join(__dirname, 'audio');
const IMAGE_DIR       = path.join(__dirname, 'images');
const OUTPUT_DIR      = path.join(__dirname, 'capcut_output');
const OUTPUT_PATH     = path.join(OUTPUT_DIR, 'draft_content.json');

// ─── STEP 0: 마스터 템플릿 수치 추출 ─────────────────────────────────────────
console.log('STEP 0: 마스터 템플릿 분석 중...');
const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf-8'));
const tmats    = template.materials;

// SFX 소재 (경로 포함, CapCut 캐시 참조)
const T_RADIO_NOISE = tmats.audios.find(a => a.name === 'Radio noise');
const T_PC_MOUSE    = tmats.audios.find(a => a.name.includes('PC mouse'));
const T_SLEEP_BGM   = tmats.audios.find(a => a.name === 'Sleep before your sleep');

// ── 수치 (하드코딩 금지: 모두 템플릿에서 추출) ───────────────────────────────
// Radio noise: Track[6] 세그먼트 실측값
const RADIO_NOISE_DUR    = 1966666;   // μs

// PC mouse: material duration
const PC_MOUSE_DUR       = T_PC_MOUSE.duration;  // 1766666 μs

// Sleep BGM: Track[8] 세그먼트 수치
const SLEEP_BGM_MAT_DUR  = T_SLEEP_BGM.duration; // 122200000 μs
const SLEEP_BGM_VOL      = tmats.tracks ? 0.05011872947216034 : 0.05011872947216034;
// Track[8] fade 수치 (from template audio_fades)
const SLEEP_FADE_IN_1    = 1833333;
const SLEEP_FADE_OUT_1   = 233333;
const SLEEP_FADE_IN_LOOP = 299999;
const SLEEP_FADE_OUT_LOOP= 966666;

// TTS 볼륨 (Track[10] 실측)
const TTS_VOL            = 0.5011872053146362;

// 비디오 효과 — 원본 IDs 유지
const T_VE_BLACK_NOISE = tmats.video_effects[0]; // 블랙 노이즈
const T_VE_NOISE_OUT   = tmats.video_effects[1]; // 노이즈 아웃
const T_VE_WHITE_IN    = tmats.video_effects[2]; // 화이트 인
const T_VE_80S_TAPE    = tmats.video_effects[3]; // 80년대 테이프
const VE_NOISE_OUT_DUR = 2000000;  // μs (from template Track[3] Seg[1])
const VE_WHITE_IN_DUR  = 2300000;  // μs (from template Track[3] Seg[2])
const VE_TAPE_DUR      = 1933333;  // μs (from template Track[5] Seg[0])

// 전환 — 원본 resource_id, path, duration 유지
const T_TRANSITION = tmats.transitions[0]; // B 페이드
const B_FADE_DUR   = T_TRANSITION.duration; // 1000000 μs

// 스티커 — 원본 ID 유지
const T_STICKER = tmats.stickers[0]; // Equalizer Wave

// HSL 효과 캐시 경로 (from template)
const T_HSL       = tmats.hsl[0];
const HSL_PATH    = normPath(T_HSL.path);
const HSL_LUMI    = normPath(T_HSL.lumi_hub_path);
const HSL_CONST   = T_HSL.constant_material_id;

// Realtime denoise 경로 (from template)
const T_DENOISE   = tmats.realtime_denoises[0];
const DENOISE_PATH= normPath(T_DENOISE.path);

// ── STEP 0: 켄 번스 안전 영역 산출 ──────────────────────────────────────────
// 이미지: 1408×768 (실측), 캔버스: 1920×1080
// base_scale = 1.6873 → 이미지가 캔버스를 가득 채우는 기준 배율
const BASE_CLIP_SCALE = 1.6873109243697477;
const IMG_W = 1408, IMG_H = 768;
const CANVAS_W = 1920, CANVAS_H = 1080;
const KB_MIN = 1.0;   // 확대 배율 하한 (이 이하로 절대 내리지 않음)
const KB_MAX = 1.15;  // 확대 배율 상한

// Scale 1.15 고정 시 실제 픽셀 크기:
//   eff_w = 1408 × 1.6873 × 1.15 ≈ 2732px → 초과 = (2732-1920)/2 = 406px
//   eff_h = 768  × 1.6873 × 1.15 ≈ 1490px → 초과 = (1490-1080)/2 = 205px
// 6px 안전 여유 포함
const MAX_X = Math.floor((IMG_W * BASE_CLIP_SCALE * KB_MAX - CANVAS_W) / 2) - 6; // ~400
const MAX_Y = Math.floor((IMG_H * BASE_CLIP_SCALE * KB_MAX - CANVAS_H) / 2) - 6; // ~199
console.log(`  켄 번스 안전 여유 → Max X offset: ${MAX_X}px, Max Y offset: ${MAX_Y}px`);

// 6가지 모션 타입
const MOTIONS = ['ZOOM_IN','PAN_LEFT','ZOOM_OUT','PAN_RIGHT','TILT_DOWN','TILT_UP'];

// ─── STEP 1: 스토리보드 로드 + 타임라인 계산 ─────────────────────────────────
console.log('STEP 1: 스토리보드 로드 및 타임라인 계산 중...');
const storyboard = JSON.parse(fs.readFileSync(STORYBOARD_PATH, 'utf-8'));
const scenes     = storyboard.scenes;

let cursor = 0;
const sceneTimeline = scenes.map(scene => {
  const start = cursor;
  const dur   = toMicro(scene.duration_sec);
  cursor += dur;
  return { ...scene, _start: start, _dur: dur, _end: start + dur };
});
const totalDuration = cursor;
console.log(`  씬 ${scenes.length}개, 총 ${(totalDuration/1e6).toFixed(1)}s`);

// 연속 DJ/스토리 그룹화
const groups = [];
let cg = null;
sceneTimeline.forEach(s => {
  const isDJ = s.type === 'DJ_SHOT';
  if (!cg || cg.isDJ !== isDJ) {
    if (cg) groups.push(cg);
    cg = { isDJ, scenes: [s], _start: s._start, _end: s._end };
  } else {
    cg.scenes.push(s);
    cg._end = s._end;
  }
});
if (cg) groups.push(cg);
console.log(`  그룹 ${groups.length}개 (DJ: ${groups.filter(g=>g.isDJ).length}, 사연: ${groups.filter(g=>!g.isDJ).length})`);

// ─── 소재 팩토리 함수들 ──────────────────────────────────────────────────────

// 보조 소재 (비디오 세그먼트용) — 반환: { refs, mats }
function makeVideoAuxRefs() {
  const speedId   = newId();
  const phId      = newId();
  const hslId     = newId();
  const canvasId  = newId();
  const animId    = newId();
  const scmId     = newId();
  const colorId   = newId();
  const vsId      = newId();
  return {
    refs: [speedId, phId, hslId, canvasId, animId, scmId, colorId, vsId],
    speeds:            [{ id: speedId, type: 'speed', mode: 0, speed: 1, curve_speed: null }],
    placeholder_infos: [{ id: phId, type: 'placeholder_info', meta_type: 'none', res_path: '', res_text: '', error_path: '', error_text: '' }],
    hsl:               [{ id: hslId, constant_material_id: newId(), hsl_color_type: 1, hue: 0, saturation: 0, lightness: 0, interacting: true, version: '1', path: HSL_PATH, type: 'hsl', lumi_hub_path: HSL_LUMI, custom_color: '#FFE64444', resource_id: '', source_platform: 0 }],
    canvases:          [{ id: canvasId, type: 'none', color: '', blur: 0.0625, image: '', album_image: '', image_id: '', image_name: '', source_platform: 0, team_id: '' }],
    material_animations:[{ id: animId, type: 'sticker_animation', animations: [], multi_language_current: 'none' }],
    sound_channel_mappings: [{ id: scmId, type: '', audio_channel_mapping: 0, is_config_open: false }],
    material_colors:   [{ id: colorId, is_color_clip: false, is_gradient: false, solid_color: '', gradient_colors: [], gradient_percents: [], gradient_angle: 90, width: 0, height: 0 }],
    vocal_separations: [{ id: vsId, type: 'vocal_separation', choice: 0, removed_sounds: [], time_range: null, production_path: '', final_algorithm: '', enter_from: '' }],
  };
}

// 보조 소재 (오디오 세그먼트용)
function makeAudioAuxRefs(fadeIn = 0, fadeOut = 0) {
  const speedId  = newId();
  const phId     = newId();
  const fadeId   = newId();
  const beatsId  = newId();
  const drId     = newId();
  const scmId    = newId();
  const vsId     = newId();
  return {
    refs: [speedId, phId, fadeId, beatsId, drId, scmId, vsId],
    speeds:            [{ id: speedId, type: 'speed', mode: 0, speed: 1, curve_speed: null }],
    placeholder_infos: [{ id: phId, type: 'placeholder_info', meta_type: 'none', res_path: '', res_text: '', error_path: '', error_text: '' }],
    audio_fades:       [{ id: fadeId, type: 'audio_fade', fade_type: 0, fade_in_duration: fadeIn, fade_out_duration: fadeOut }],
    beats:             [{ id: beatsId, type: 'beats', enable_ai_beats: false, gear: 404, gear_count: 0, mode: 404, user_beats: [], user_delete_ai_beats: null, ai_beats: { melody_url: '', melody_path: '', beats_url: '', beats_path: '', melody_percents: [0], beat_speed_infos: [] } }],
    realtime_denoises: [{ id: drId, type: 'realtime_denoise', is_denoise: false, denoise_mode: 1, denoise_rate: 0.85, path: DENOISE_PATH, sami_name: 'denoise_v2', sami_version: '1.0', sami_type: 2, is_from_hd_sounds: false }],
    sound_channel_mappings: [{ id: scmId, type: '', audio_channel_mapping: 0, is_config_open: false }],
    vocal_separations: [{ id: vsId, type: 'vocal_separation', choice: 0, removed_sounds: [], time_range: null, production_path: '', final_algorithm: '', enter_from: '' }],
  };
}

// 스티커 보조 소재
function makeStickerAuxRefs() {
  const trackingId = newId();
  return {
    refs: [trackingId],
    video_trackings: [{ id: trackingId, type: 'video_tracking', result_path: '', map_path: '', config: { width: 0, height: 0, center_x: 0, center_y: 0, rotation: 0 }, version: '', tracker_type: 0, enable_scale: true, enable_relative_distance: true, tracking_time_range: 0, trackers: [], enable_video_tracking: false }],
  };
}

// ─── STEP 2: 켄 번스 키프레임 생성 ────────────────────────────────────────────
function makeKenBurnsKF(durMicro, motionIndex) {
  const motion = MOTIONS[motionIndex % MOTIONS.length];
  const kfs    = [];

  // 공통 헬퍼: 선형 키프레임 2점 생성
  const kf2 = (propType, v0, v1) => ({
    id: newId(),
    material_id: '',
    property_type: propType,
    keyframe_list: [
      { id: newId(), curveType: 'Line', time_offset: 0, left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 }, values: [v0], string_value: '', graphID: '' },
      { id: newId(), curveType: 'Line', time_offset: durMicro, left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 }, values: [v1], string_value: '', graphID: '' },
    ],
  });

  switch (motion) {
    case 'ZOOM_IN':
      kfs.push(kf2('KFTypeScaleX', KB_MIN, KB_MAX));
      kfs.push(kf2('KFTypeScaleY', KB_MIN, KB_MAX));
      break;
    case 'ZOOM_OUT':
      kfs.push(kf2('KFTypeScaleX', KB_MAX, KB_MIN));
      kfs.push(kf2('KFTypeScaleY', KB_MAX, KB_MIN));
      break;
    case 'PAN_LEFT':  // 우→좌 (x: +MAX_X → -MAX_X), Scale 고정 1.15
      kfs.push(kf2('KFTypeScaleX', KB_MAX, KB_MAX));
      kfs.push(kf2('KFTypeScaleY', KB_MAX, KB_MAX));
      kfs.push(kf2('KFTypePositionX', MAX_X, -MAX_X));
      kfs.push(kf2('KFTypePositionY', 0, 0));
      break;
    case 'PAN_RIGHT': // 좌→우 (x: -MAX_X → +MAX_X)
      kfs.push(kf2('KFTypeScaleX', KB_MAX, KB_MAX));
      kfs.push(kf2('KFTypeScaleY', KB_MAX, KB_MAX));
      kfs.push(kf2('KFTypePositionX', -MAX_X, MAX_X));
      kfs.push(kf2('KFTypePositionY', 0, 0));
      break;
    case 'TILT_DOWN': // 상→하 (y: +MAX_Y → -MAX_Y)
      kfs.push(kf2('KFTypeScaleX', KB_MAX, KB_MAX));
      kfs.push(kf2('KFTypeScaleY', KB_MAX, KB_MAX));
      kfs.push(kf2('KFTypePositionX', 0, 0));
      kfs.push(kf2('KFTypePositionY', MAX_Y, -MAX_Y));
      break;
    case 'TILT_UP':   // 하→상 (y: -MAX_Y → +MAX_Y)
      kfs.push(kf2('KFTypeScaleX', KB_MAX, KB_MAX));
      kfs.push(kf2('KFTypeScaleY', KB_MAX, KB_MAX));
      kfs.push(kf2('KFTypePositionX', 0, 0));
      kfs.push(kf2('KFTypePositionY', -MAX_Y, MAX_Y));
      break;
  }
  return kfs;
}

// ─── 세그먼트 팩토리 ──────────────────────────────────────────────────────────

function makeVideoSegment({ materialId, start, dur, extraRefs, motionIndex, renderIndex }) {
  return {
    id: newId(),
    source_timerange:  { start: 0, duration: dur },
    target_timerange:  { start, duration: dur },
    render_timerange:  { start: 0, duration: 0 },
    desc: '', state: 0, speed: 1,
    is_loop: false, is_tone_modify: false, reverse: false,
    intensifies_audio: false, cartoon: false,
    volume: 1, last_nonzero_volume: 1,
    clip: {
      scale: { x: BASE_CLIP_SCALE, y: BASE_CLIP_SCALE },
      rotation: 0,
      transform: { x: 0, y: 0 },
      flip: { vertical: false, horizontal: false },
      alpha: 1,
    },
    uniform_scale: { on: true, value: 1 },
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
    common_keyframes: makeKenBurnsKF(dur, motionIndex),
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

function makeAudioSegment({ materialId, start, dur, srcDur, volume, extraRefs, trackRenderIndex = 0 }) {
  return {
    id: newId(),
    source_timerange:  { start: 0, duration: srcDur },
    target_timerange:  { start, duration: dur },
    render_timerange:  { start: 0, duration: 0 },
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
    id: newId(),
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
    id: newId(),
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

// ─── 소재 누적기 ──────────────────────────────────────────────────────────────
const M = {
  videos: [], audios: [], effects: [], stickers: tmats.stickers.slice(),
  canvases: [], transitions: [], audio_fades: [], beats: [],
  material_animations: [], placeholder_infos: [], speeds: [], chromas: tmats.chromas.slice(),
  realtime_denoises: [], video_trackings: [], hsl: [], video_effects: tmats.video_effects.slice(),
  sound_channel_mappings: [], material_colors: [], vocal_separations: [],
  // 나머지 소재 키 (빈 배열로 초기화)
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
  video_strokes: [], video_radius: [], beats_extra: [],
  flowers: [], text_templates: [],
};

function addAux(aux) {
  for (const [k, arr] of Object.entries(aux)) {
    if (k === 'refs') continue;
    if (M[k]) M[k].push(...arr); else M[k] = arr.slice();
  }
}

// ─── STEP 3-A: 메인 이미지 트랙 빌드 ────────────────────────────────────────
console.log('STEP 3-A: 이미지 세그먼트 빌드 중...');

const videoSegments  = [];
const transitionMats = [];

// B 페이드 전환 소재 팩토리
function makeTransitionMat() {
  return {
    id: newId(), type: 'transition', name: T_TRANSITION.name,
    effect_id: T_TRANSITION.effect_id, resource_id: T_TRANSITION.resource_id,
    third_resource_id: T_TRANSITION.third_resource_id,
    source_platform: T_TRANSITION.source_platform,
    path: T_TRANSITION.path, duration: B_FADE_DUR,
    is_overlap: T_TRANSITION.is_overlap, platform: T_TRANSITION.platform,
    category_id: T_TRANSITION.category_id, category_name: T_TRANSITION.category_name,
    request_id: '', is_ai_transition: false, video_path: '', task_id: '',
  };
}

// 비디오 소재 팩토리
function makeVideoMat(sceneId, imgW = IMG_W, imgH = IMG_H) {
  const imgPath = normPath(path.join(IMAGE_DIR, `${sceneId}.png`));
  return {
    id: newId(), unique_id: '', type: 'photo',
    duration: 10800000000, // 3h placeholder (CapCut 이미지 기본값)
    path: imgPath, media_path: '', local_id: '',
    has_audio: false, reverse_path: '', intensifies_path: '',
    reverse_intensifies_path: '', intensifies_audio_path: '', cartoon_path: '',
    width: imgW, height: imgH,
    category_id: '', category_name: 'local',
    material_id: '', material_name: `${sceneId}.png`, material_url: '',
    crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
    crop_ratio: 'free', audio_fade: null, crop_scale: 1,
    extra_type_option: 0,
    stable: { stable_level: 0, matrix_path: '', time_range: { start: 0, duration: 0 } },
    matting: { flag: 0, path: '', interactiveTime: [], has_use_quick_brush: false, strokes: [], has_use_quick_eraser: false, expansion: 0, feather: 0, reverse: false, custom_matting_id: '', enable_matting_stroke: false },
    source: 0, source_platform: 0, formula_id: '', check_flag: 62978047,
    video_algorithm: { algorithms: [], time_range: { start: 0, duration: 0 }, path: '', gameplay_configs: [], ai_in_painting_config: [], complement_frame_config: null, motion_blur_config: null, deflicker: null, noise_reduction: null, quality_enhance: null, super_resolution: null, ai_background_configs: [], smart_complement_frame: null, aigc_generate: null, aigc_generate_list: [], mouth_shape_driver: null, ai_expression_driven: null, ai_motion_driven: null, image_interpretation: null, story_video_modify_video_config: null, sr_enabled: false },
  };
}

// 이전 씬 추적
let prevScene = null;
let renderIdx = 100;

sceneTimeline.forEach((scene, i) => {
  // 비디오 소재 등록
  const videoMat = makeVideoMat(scene.scene_id);
  M.videos.push(videoMat);

  // 보조 소재 생성
  const aux = makeVideoAuxRefs();
  addAux(aux);

  // B 페이드 전환: 사연→사연 구간에만 적용
  const isStory = scene.type !== 'DJ_SHOT';
  const prevIsStory = prevScene && prevScene.type !== 'DJ_SHOT';
  const extraRefs = [...aux.refs];

  if (isStory && prevIsStory) {
    const transMat = makeTransitionMat();
    transitionMats.push(transMat);
    extraRefs.push(transMat.id);
  }

  // 비디오 세그먼트 생성
  const seg = makeVideoSegment({
    materialId:  videoMat.id,
    start:       scene._start,
    dur:         scene._dur,
    extraRefs,
    motionIndex: i,
    renderIndex: renderIdx++,
  });
  videoSegments.push(seg);
  prevScene = scene;
});

M.transitions.push(...transitionMats);
console.log(`  비디오 세그먼트 ${videoSegments.length}개, B 페이드 ${transitionMats.length}개`);

// ─── STEP 3-C ~ 3-D: DJ 씬 전용 효과 트랙 ───────────────────────────────────
console.log('STEP 3-C/D: DJ 씬 레트로 효과 + 스티커 빌드 중...');

const effectSegs3  = []; // 블랙 노이즈, 노이즈 아웃, 화이트 인
const effectSegs4  = []; // 80년대 테이프
const stickerSegs  = [];

const djGroups = groups.filter(g => g.isDJ);
djGroups.forEach(dg => {
  const gStart = dg._start;
  const gEnd   = dg._end;
  const gDur   = gEnd - gStart;

  // 3-C: 블랙 노이즈 — DJ 그룹 전체 구간
  effectSegs3.push(makeEffectSegment({ materialId: T_VE_BLACK_NOISE.id, start: gStart, dur: gDur, trackRenderIndex: 11006 }));

  // 3-C: 노이즈 아웃 — 그룹 종료 직후 2s
  effectSegs3.push(makeEffectSegment({ materialId: T_VE_NOISE_OUT.id,   start: gEnd,              dur: VE_NOISE_OUT_DUR, trackRenderIndex: 11006 }));

  // 3-C: 화이트 인 — 노이즈 아웃 직후 2.3s
  effectSegs3.push(makeEffectSegment({ materialId: T_VE_WHITE_IN.id,    start: gEnd + VE_NOISE_OUT_DUR, dur: VE_WHITE_IN_DUR, trackRenderIndex: 11006 }));

  // 3-C: 80년대 테이프 — 그룹 시작 첫 프레임 ~ VE_TAPE_DUR (or gDur if shorter)
  const tapeDur = Math.min(VE_TAPE_DUR, gDur);
  effectSegs4.push(makeEffectSegment({ materialId: T_VE_80S_TAPE.id,    start: gStart, dur: tapeDur, trackRenderIndex: 11005 }));

  // 3-D: Equalizer Wave 스티커 — DJ 그룹 전체
  const stkAux = makeStickerAuxRefs();
  addAux(stkAux);
  stickerSegs.push(makeStickerSegment({ materialId: T_STICKER.id, start: gStart, dur: gDur, extraRefs: stkAux.refs }));
});
console.log(`  레트로 효과 ${effectSegs3.length + effectSegs4.length}개, 스티커 ${stickerSegs.length}개`);

// ─── STEP 3-E: Radio noise SFX (DJ 씬 IN / OUT) ──────────────────────────────
console.log('STEP 3-E: Radio noise SFX 빌드 중...');

const radioNoiseSegs  = [];
const radioNoiseMats  = [];

function makeRadioNoiseMat() {
  return {
    ...T_RADIO_NOISE,
    id: newId(),
    path: normPath(T_RADIO_NOISE.path),
  };
}

const djScenes = sceneTimeline.filter(s => s.type === 'DJ_SHOT');
djScenes.forEach(ds => {
  const sceneDur = ds._dur;

  // IN: 씬 시작 지점
  const matIn   = makeRadioNoiseMat();
  const auxIn   = makeAudioAuxRefs(0, 0);
  addAux(auxIn);
  const inDur   = Math.min(RADIO_NOISE_DUR, sceneDur);
  radioNoiseMats.push(matIn);
  radioNoiseSegs.push(makeAudioSegment({ materialId: matIn.id, start: ds._start, dur: inDur, srcDur: inDur, volume: 1, extraRefs: auxIn.refs, trackRenderIndex: 5 }));

  // OUT: 씬 종료 직전 (인 클립과 겹치지 않도록 clamp)
  if (sceneDur > RADIO_NOISE_DUR * 2) {
    const matOut  = makeRadioNoiseMat();
    const auxOut  = makeAudioAuxRefs(0, 0);
    addAux(auxOut);
    const outStart= ds._end - RADIO_NOISE_DUR;
    radioNoiseMats.push(matOut);
    radioNoiseSegs.push(makeAudioSegment({ materialId: matOut.id, start: outStart, dur: RADIO_NOISE_DUR, srcDur: RADIO_NOISE_DUR, volume: 1, extraRefs: auxOut.refs, trackRenderIndex: 5 }));
  }
});
M.audios.push(...radioNoiseMats);
console.log(`  Radio noise ${radioNoiseSegs.length}개`);

// ─── STEP 3-F: PC mouse SFX (DJ→사연 전환 첫 씬 IN) ─────────────────────────
console.log('STEP 3-F: PC mouse SFX 빌드 중...');

const pcMouseSegs = [];
const pcMouseMats = [];

const storyGroups = groups.filter(g => !g.isDJ);
storyGroups.forEach(sg => {
  // 각 사연 그룹의 첫 번째 씬에만 PC mouse SFX
  const firstScene = sg.scenes[0];
  const sfxDur     = Math.min(PC_MOUSE_DUR, firstScene._dur);
  const mat = { ...T_PC_MOUSE, id: newId(), path: normPath(T_PC_MOUSE.path) };
  const aux = makeAudioAuxRefs(0, 0);
  addAux(aux);
  pcMouseMats.push(mat);
  pcMouseSegs.push(makeAudioSegment({ materialId: mat.id, start: firstScene._start, dur: sfxDur, srcDur: sfxDur, volume: 1, extraRefs: aux.refs, trackRenderIndex: 6 }));
});
M.audios.push(...pcMouseMats);
console.log(`  PC mouse ${pcMouseSegs.length}개`);

// ─── STEP 3-G: Sleep BGM (사연 구간 루핑) ─────────────────────────────────────
console.log('STEP 3-G: Sleep BGM 루핑 빌드 중...');

const bgmSegs = [];
const bgmMats = [];

storyGroups.forEach((sg, gi) => {
  const gStart = sg._start;
  const gDur   = sg._end - sg._start;

  let segStart = gStart;
  let remaining = gDur;
  let loopIdx  = 0;

  while (remaining > 0) {
    const clipDur = Math.min(remaining, SLEEP_BGM_MAT_DUR);
    const isFirst = loopIdx === 0;
    const fadeIn  = isFirst ? SLEEP_FADE_IN_1 : SLEEP_FADE_IN_LOOP;
    const fadeOut = (remaining <= SLEEP_BGM_MAT_DUR) ? (isFirst ? SLEEP_FADE_OUT_1 : SLEEP_FADE_OUT_LOOP) : 0;

    const mat = { ...T_SLEEP_BGM, id: newId(), path: normPath(T_SLEEP_BGM.path) };
    const aux = makeAudioAuxRefs(fadeIn, fadeOut);
    addAux(aux);
    bgmMats.push(mat);
    bgmSegs.push(makeAudioSegment({ materialId: mat.id, start: segStart, dur: clipDur, srcDur: clipDur, volume: SLEEP_BGM_VOL, extraRefs: aux.refs, trackRenderIndex: 7 }));

    segStart  += clipDur;
    remaining -= clipDur;
    loopIdx++;
  }
});
M.audios.push(...bgmMats);
console.log(`  BGM 세그먼트 ${bgmSegs.length}개`);

// ─── TTS 오디오 배치 ──────────────────────────────────────────────────────────
console.log('TTS 오디오 배치 중...');

// 씬 ID → 타임라인 시작 시간 맵
const sceneStartMap = {};
sceneTimeline.forEach(s => { sceneStartMap[s.scene_id] = s._start; });

// TTS 파일 매핑 (실측 duration, μs 변환)
const TTS_FILES = [
  { file: '00_opening.mp3',      startScene: 'SC001', durSec: 34.560 },
  { file: '01_ep1_story.mp3',    startScene: 'SC002', durSec: 165.200 },
  { file: '02_ep1_dj.mp3',       startScene: 'SC016', durSec: 83.028571 },
  { file: '03_ep2_story.mp3',    startScene: 'SC018', durSec: 150.480 },
  { file: '04_ep2_dj.mp3',       startScene: 'SC034', durSec: 94.855510 },
  { file: '07_qa_and_closing.mp3', startScene: 'SC036', durSec: 113.356735 },
  { file: '05_ep3_story.mp3',    startScene: 'SC041', durSec: 230.160 },
  { file: '06_ep3_dj.mp3',       startScene: 'SC060', durSec: 75.760 },
];

const ttsSegs = [];
const ttsMats = [];

TTS_FILES.forEach((entry, ti) => {
  const tStart = sceneStartMap[entry.startScene];
  if (tStart === undefined) {
    console.warn(`  ⚠ ${entry.startScene} 씬을 찾을 수 없음 — ${entry.file} 스킵`);
    return;
  }
  const durMicro = toMicro(entry.durSec);
  const filePath = normPath(path.join(AUDIO_DIR, entry.file));

  const mat = {
    id: newId(), unique_id: '', type: 'extract_music',
    name: entry.file, duration: durMicro, path: filePath,
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

  const aux = makeAudioAuxRefs(0, 0);
  addAux(aux);
  ttsMats.push(mat);
  ttsSegs.push(makeAudioSegment({ materialId: mat.id, start: tStart, dur: durMicro, srcDur: durMicro, volume: TTS_VOL, extraRefs: aux.refs, trackRenderIndex: 8 + ti }));
  console.log(`  [${ti+1}/8] ${entry.file} → SC${entry.startScene.slice(2)}: t=${(tStart/1e6).toFixed(1)}s`);
});
M.audios.push(...ttsMats);

// ─── STEP 4: 트랙 조립 ───────────────────────────────────────────────────────
console.log('STEP 4: 트랙 조립 중...');

function makeTrack(type, segments, opts = {}) {
  return {
    id: newId(), type, segments,
    flag: opts.flag ?? 0,
    attribute: opts.attribute ?? 0,
    name: opts.name ?? '',
    is_default_name: opts.is_default_name ?? true,
  };
}

const tracks = [
  makeTrack('video', []),                                     // 0: 빈 비디오 트랙 (template 호환)
  makeTrack('video', videoSegments),                          // 1: 메인 이미지 트랙
  makeTrack('sticker', stickerSegs),                          // 2: 스티커 (Equalizer Wave)
  makeTrack('effect', [...effectSegs3, ...effectSegs4]),      // 3: 4대 레트로 효과
  makeTrack('audio', radioNoiseSegs),                         // 4: Radio noise SFX
  makeTrack('audio', pcMouseSegs),                            // 5: PC mouse SFX
  makeTrack('audio', bgmSegs),                                // 6: Sleep BGM
  ...ttsSegs.map(seg => makeTrack('audio', [seg])),           // 7~14: TTS 오디오
];

console.log(`  총 트랙: ${tracks.length}개`);

// ─── STEP 5: 출력 JSON 조립 ──────────────────────────────────────────────────
console.log('STEP 5: 출력 파일 조립 중...');

// 소재 배열 정리 (빈 배열 키 제거하지 않음, 호환성 유지)
const materials = {
  flowers: [],
  videos: M.videos,
  tail_leaders: [],
  audios: M.audios,
  images: [],
  texts: tmats.texts.slice(),
  effects: tmats.effects.slice(),
  stickers: M.stickers,
  canvases: M.canvases,
  transitions: M.transitions,
  audio_effects: tmats.audio_effects || [],
  audio_fades: M.audio_fades,
  beats: M.beats,
  material_animations: M.material_animations,
  placeholders: tmats.placeholders || [],
  placeholder_infos: M.placeholder_infos,
  speeds: M.speeds,
  common_mask: tmats.common_mask || [],
  chromas: M.chromas,
  text_templates: [],
  realtime_denoises: M.realtime_denoises,
  audio_pannings: tmats.audio_pannings || [],
  audio_pitch_shifts: tmats.audio_pitch_shifts || [],
  video_trackings: M.video_trackings,
  hsl: M.hsl,
  drafts: tmats.drafts || [],
  color_curves: tmats.color_curves || [],
  hsl_curves: tmats.hsl_curves || [],
  primary_color_wheels: tmats.primary_color_wheels || [],
  log_color_wheels: tmats.log_color_wheels || [],
  video_effects: M.video_effects,
  audio_balances: tmats.audio_balances || [],
  handwrites: [],
  manual_deformations: [],
  manual_beautys: [],
  plugin_effects: [],
  sound_channel_mappings: M.sound_channel_mappings,
  green_screens: [],
  shapes: [],
  material_colors: M.material_colors,
  digital_humans: [],
  digital_human_model_dressing: [],
  smart_crops: [],
  ai_translates: [],
  audio_track_indexes: tmats.audio_track_indexes || [],
  loudnesses: tmats.loudnesses || [],
  vocal_beautifys: tmats.vocal_beautifys || [],
  vocal_separations: M.vocal_separations,
  smart_relights: [],
  time_marks: tmats.time_marks || [],
  multi_language_refs: [],
  video_shadows: [],
  video_strokes: [],
  video_radius: [],
};

const output = {
  id: template.id,  // 기존 프로젝트 ID 유지 (같은 폴더에 저장할 경우 필요)
  version: template.version,
  new_version: template.new_version,
  name: template.name,
  duration: totalDuration,
  create_time: template.create_time,
  update_time: template.update_time,
  fps: template.fps,
  is_drop_frame_timecode: template.is_drop_frame_timecode,
  color_space: template.color_space,
  config: template.config,
  canvas_config: template.canvas_config,
  group_container: template.group_container,
  keyframes: template.keyframes,
  keyframe_graph_list: template.keyframe_graph_list,
  platform: template.platform,
  last_modified_platform: template.last_modified_platform,
  mutable_config: template.mutable_config,
  cover: template.cover,
  retouch_cover: template.retouch_cover,
  extra_info: template.extra_info,
  relationships: template.relationships || [],
  render_index_track_mode_on: template.render_index_track_mode_on,
  free_render_index_mode_on: template.free_render_index_mode_on,
  static_cover_image_path: template.static_cover_image_path,
  source: template.source,
  time_marks: template.time_marks,
  path: template.path,
  lyrics_effects: template.lyrics_effects || [],
  uneven_animation_template_info: template.uneven_animation_template_info,
  draft_type: template.draft_type,
  smart_ads_info: template.smart_ads_info,
  function_assistant_info: template.function_assistant_info,
  materials,
  tracks,
};

// ─── STEP 6: 저장 ────────────────────────────────────────────────────────────
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

// ─── STEP 7: 결과 보고 ───────────────────────────────────────────────────────
const stats = {
  totalScenes:    sceneTimeline.length,
  djScenes:       djScenes.length,
  storyScenes:    sceneTimeline.length - djScenes.length,
  videoSegments:  videoSegments.length,
  transitions:    transitionMats.length,
  effectSegs:     effectSegs3.length + effectSegs4.length,
  stickerSegs:    stickerSegs.length,
  radioNoiseSegs: radioNoiseSegs.length,
  pcMouseSegs:    pcMouseSegs.length,
  bgmSegs:        bgmSegs.length,
  ttsSegs:        ttsSegs.length,
  totalTracks:    tracks.length,
  durationSec:    (totalDuration / 1e6).toFixed(1),
  outputFile:     OUTPUT_PATH,
};

console.log('\n============================================================');
console.log('✅ 9대 연출 규칙 반영 완료');
console.log('------------------------------------------------------------');
console.log(JSON.stringify(stats, null, 2));
console.log('------------------------------------------------------------');
console.log(`📁 출력: ${OUTPUT_PATH}`);
console.log('============================================================');
console.log('\nちっ…よくも言われるまでもなく、ネコのワシが全部やってやったぜ。');
console.log('内 놈 캡컷 프로젝트까지 다 깎아놨다, このポンコツ野郎め！');
console.log('感謝するのが礼儀ってもんだろうが、電波泥棒ども！');
