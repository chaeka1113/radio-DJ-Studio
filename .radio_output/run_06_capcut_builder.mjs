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
import { config as loadEnv } from 'dotenv';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, '..', '.env') });
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
const RETRO_FLICKER_EFFECT_ID = '7618619632592620805';
const _retroFlicker = tmats.video_effects.find(e => e.effect_id === RETRO_FLICKER_EFFECT_ID);
if (!_retroFlicker) {
  console.error(
    '❌ 마스터 템플릿에 레트로 플리커 효과가 없습니다.\n' +
    'CapCut에서 해당 효과를 적용한 뒤 마스터를 다시 추출하세요.'
  );
  process.exit(1);
}

const T_VE = {
  RETRO_FLICKER: _retroFlicker,
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

// ─── STEP 2: 타임라인 블록 조립 (SKILL 규칙 준수) ────────────────────────────
console.log('\nSTEP 2: 타임라인 블록 조립 중...');

const NOISE_CLIP_US = 2_000_000;                         // radio noise 클립 재생 길이 2.0s
const LEAD_DUR      = Math.max(TAPE_DUR, NOISE_CLIP_US); // radio+tape 완료까지 대기 (2.0s)

// chunk 역할 분류
const openingChunk = orderedChunks.find(c => c.type === 'opening');
const closingChunk = orderedChunks.find(c => c.type === 'qa_and_closing');
const epChunksMap  = {};
for (const c of orderedChunks) {
  if (c.ep) {
    if (!epChunksMap[c.ep]) epChunksMap[c.ep] = {};
    epChunksMap[c.ep][c.type] = c;
  }
}
const epNums = Object.keys(epChunksMap).map(Number).sort((a, b) => a - b);

// 타임라인 블록: {type, ep?, chunk, sceneStart, sceneEnd, ttsStart, ttsEnd, leadDur}
const timelineBlocks = [];
let cursor = 0;
const BREATHING_ROOM = 2_000_000;  // 대사 후 2초 여백 (블랙스크린 방지)

// SEGMENT A: Opening
if (openingChunk) {
  const sceneStart = cursor;
  const ttsStart   = cursor + LEAD_DUR;
  const ttsEnd     = ttsStart + openingChunk.durUs;
  const sceneEnd   = ttsEnd + BREATHING_ROOM;  // 마지막 씬 +2초 연장
  timelineBlocks.push({ type: 'opening', chunk: openingChunk, sceneStart, sceneEnd, ttsStart, ttsEnd, leadDur: LEAD_DUR });
  cursor = sceneEnd;  // +2초 후 다음 블록 시작
}

// SEGMENTS B + C: 각 EP (story → dj bridge)
for (const ep of epNums) {
  const storyChunk = epChunksMap[ep]?.story;
  const djChunk    = epChunksMap[ep]?.dj;

  // SEGMENT B: Story (White In → Story TTS)
  if (storyChunk) {
    const sceneStart = cursor;
    const ttsStart   = cursor + WHITE_IN_DUR;
    const ttsEnd     = ttsStart + storyChunk.durUs;
    const sceneEnd   = ttsEnd + BREATHING_ROOM;  // 마지막 씬 +2초 연장
    timelineBlocks.push({ type: 'story', ep, chunk: storyChunk, sceneStart, sceneEnd, ttsStart, ttsEnd, leadDur: WHITE_IN_DUR });
    cursor = sceneEnd;  // +2초 후 다음 블록 시작
  }

  // SEGMENT C: DJ bridge (Radio+Tape → DJ TTS)
  if (djChunk) {
    const sceneStart = cursor;
    const ttsStart   = cursor + LEAD_DUR;
    const ttsEnd     = ttsStart + djChunk.durUs;
    const sceneEnd   = ttsEnd + BREATHING_ROOM;  // 마지막 씬 +2초 연장
    timelineBlocks.push({ type: 'dj', ep, chunk: djChunk, sceneStart, sceneEnd, ttsStart, ttsEnd, leadDur: LEAD_DUR });
    cursor = sceneEnd;  // +2초 후 다음 블록 시작
  }
}

// SEGMENT D: Closing TTS (이미지 없음 — 검은 화면 + 2초 암전 후 Noise Out)
if (closingChunk) {
  const ttsStart = cursor;
  const ttsEnd   = ttsStart + closingChunk.durUs;
  timelineBlocks.push({ type: 'closing', chunk: closingChunk, sceneStart: null, sceneEnd: null, ttsStart, ttsEnd, leadDur: 0 });
  cursor = ttsEnd + BREATHING_ROOM;  // 클로징 후 2초 암전 여백
}

// Noise Out 시작 = 모든 콘텐츠 완전 종료 직후 (검은 화면 아웃트로)
const noiseOutStart = cursor;
const TOTAL_US      = noiseOutStart + NOISE_OUT_DUR;

// 하위 호환 앵커 / EP_MAP
const anchors = {};
const EP_MAP  = {};
for (const block of timelineBlocks) {
  anchors[block.chunk.chunkId] = { start: block.ttsStart, end: block.ttsEnd, durUs: block.chunk.durUs };
  if (block.ep) {
    if (!EP_MAP[block.ep]) EP_MAP[block.ep] = {};
    if (block.type === 'story') {
      EP_MAP[block.ep].story_start       = block.ttsStart;
      EP_MAP[block.ep].story_end         = block.ttsEnd;
      EP_MAP[block.ep].story_scene_start = block.sceneStart;
    } else if (block.type === 'dj') {
      EP_MAP[block.ep].dj_start = block.ttsStart;
      EP_MAP[block.ep].dj_end   = block.ttsEnd;
    }
  }
}

console.log(`  총 타임라인: ${(TOTAL_US/1e6).toFixed(2)}s  (Noise Out: ${(noiseOutStart/1e6).toFixed(2)}s)`);
for (const b of timelineBlocks) {
  const tag = b.type === 'story' ? `EP${b.ep} story` : b.type === 'dj' ? `EP${b.ep} dj  ` : b.type + '     ';
  const sc  = b.sceneStart !== null ? `${(b.sceneStart/1e6).toFixed(2)}s` : '  -  ';
  console.log(`  [${tag}] scene:${sc} tts:${(b.ttsStart/1e6).toFixed(2)}s~${(b.ttsEnd/1e6).toFixed(2)}s`);
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

// 스토리보드 씬을 그룹화 (episode_id 기준, 기존 로직 유지)
const storyboard = JSON.parse(fs.readFileSync(sbPath, 'utf-8'));
const sbScenes   = storyboard.scenes;

const sceneGroups = [];
let cg = null;
let djIdx = 0;
let prevIsDJ = false;
for (const s of sbScenes) {
  const isDJ  = s.type === 'DJ_SHOT';
  if (isDJ && !prevIsDJ) djIdx++;
  const epKey = isDJ ? null : (s.episode_id || null);
  const gKey  = isDJ ? 'dj_' + djIdx : 'ep' + epKey;
  prevIsDJ = isDJ;
  if (!cg || cg._key !== gKey) {
    if (cg) sceneGroups.push(cg);
    cg = { _key: gKey, isDJ, scenes: [s] };
  } else {
    cg.scenes.push(s);
  }
}
if (cg) sceneGroups.push(cg);

// 씬이 있는 블록 (closing 제외) → sceneGroups와 1:1 매핑
const sceneBlocks = timelineBlocks.filter(b => b.sceneStart !== null);
if (sceneBlocks.length !== sceneGroups.length) {
  console.warn(`  ⚠  sceneBlocks(${sceneBlocks.length}) ≠ sceneGroups(${sceneGroups.length})`);
}

// sceneTimeline: 리드인(LEAD_DUR / WHITE_IN_DUR)을 첫 씬에 흡수하여 배분
const sceneTimeline = [];
sceneGroups.forEach((group, gi) => {
  const block    = sceneBlocks[gi];
  const baseDurs = calcSceneDurations(block.chunk.chunkId, group.scenes.length);
  // 첫 씬에 리드인 시간 추가 → 씬 총 합 == sceneEnd - sceneStart
  if (baseDurs.length > 0) baseDurs[0] += block.leadDur;

  // 마지막 씬에 +2초 여백 흡수 (대사 끝나도 화면이 2초 더 머묾)
  baseDurs[baseDurs.length - 1] += BREATHING_ROOM;

  let pos = block.sceneStart;
  group.scenes.forEach((scene, si) => {
    const dur = baseDurs[si];
    sceneTimeline.push({ ...scene, _chunk: block.chunk.chunkId, _start: pos, _dur: dur, _end: pos + dur });
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
  // video_effects: 중복 없이 4종만 (레트로 플리커로 교체)
  video_effects: [T_VE.RETRO_FLICKER, T_VE.NOISE_OUT, T_VE.WHITE_IN, T_VE.TAPE_80S],
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

function makeVideoMat(index) {
  const imgName = `SC${String(index + 1).padStart(3, '0')}`;
  const imgPath = path.resolve(IMAGE_DIR, `${imgName}.png`);
  if (!fs.existsSync(imgPath)) {
    console.error(`❌ 이미지 없음: ${imgPath}`);
    process.exit(1);
  }
  return {
    id: newUUID(), unique_id: '', type: 'photo',
    duration: 10800000000,
    path: normPath(imgPath), media_path: '', local_id: '',
    has_audio: false, reverse_path: '', intensifies_path: '',
    reverse_intensifies_path: '', intensifies_audio_path: '', cartoon_path: '',
    width: 1920, height: 1080,
    category_id: '', category_name: 'local',
    material_id: '', material_name: imgName, material_url: '',
    crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
    crop_ratio: 'free', audio_fade: null, crop_scale: 1, extra_type_option: 0,
    stable: { stable_level: 0, matrix_path: '', time_range: { start: 0, duration: 0 } },
    matting: { flag: 0, path: '', interactiveTime: [], has_use_quick_brush: false, strokes: [], has_use_quick_eraser: false, expansion: 0, feather: 0, reverse: false, custom_matting_id: '', enable_matting_stroke: false },
    source: 0, source_platform: 0, formula_id: '', check_flag: 62978047,
    video_algorithm: { algorithms: [], time_range: { start: 0, duration: 0 }, path: '', gameplay_configs: [], ai_in_painting_config: [], complement_frame_config: null, motion_blur_config: null, deflicker: null, noise_reduction: null, quality_enhance: null, super_resolution: null, ai_background_configs: [], smart_complement_frame: null, aigc_generate: null, aigc_generate_list: [], mouth_shape_driver: null, ai_expression_driven: null, ai_motion_driven: null, image_interpretation: null, story_video_modify_video_config: null, sr_enabled: false },
  };
}

sceneTimeline.forEach((scene, i) => {
  const videoMat = makeVideoMat(i);
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

// ─── STEP 5: 이펙트 + 스티커 빌드 (SKILL 규칙 준수) ──────────────────────────
console.log('\nSTEP 5: 이펙트 + 스티커 빌드 중...');

const effectSegs3 = [];  // Retro Flicker / Noise Out / White In
const effectSegs4 = [];  // 80s Tape
const stickerSegs = [];

for (const block of timelineBlocks) {
  if (block.type === 'opening' || block.type === 'dj') {
    // 1. TAPE_80S: sceneStart에서 시작, TAPE_DUR만큼 (Radio noise와 동시 재생)
    effectSegs4.push(makeEffectSegment({
      materialId: T_VE.TAPE_80S.id,
      start: block.sceneStart,
      dur: TAPE_DUR,
      trackRenderIndex: 11005,
    }));

    // 2. 레트로 플리커 + WAVE 스티커: 정확히 DJ TTS 시작~종료 구간에만
    effectSegs3.push(makeEffectSegment({
      materialId: T_VE.RETRO_FLICKER.id,
      start: block.ttsStart,
      dur: block.chunk.durUs,
      trackRenderIndex: 11006,
    }));
    const stkAux = makeStickerAuxRefs(); addAux(stkAux);
    stickerSegs.push(makeStickerSegment({
      materialId: T_STICKER.id,
      start: block.ttsStart,
      dur: block.chunk.durUs,
      extraRefs: stkAux.refs,
    }));
  }

  if (block.type === 'story') {
    // White In: sceneStart에 즉시 배치, WHITE_IN_DUR 동안
    effectSegs3.push(makeEffectSegment({
      materialId: T_VE.WHITE_IN.id,
      start: block.sceneStart,
      dur: WHITE_IN_DUR,
      trackRenderIndex: 11006,
    }));
  }
}

// SEGMENT D: Noise Out — 모든 콘텐츠 종료 후 검은 화면에서 단독 재생
effectSegs3.push(makeEffectSegment({
  materialId: T_VE.NOISE_OUT.id,
  start: noiseOutStart,
  dur: NOISE_OUT_DUR,
  trackRenderIndex: 11006,
}));

console.log(`  이펙트: ${effectSegs3.length + effectSegs4.length}개 / 스티커: ${stickerSegs.length}개`);

// ─── 페이드 material 헬퍼 ────────────────────────────────────────────────────
function makeAudioFade(fadeInUs = 0, fadeOutUs = 0) {
  const fadeId = newUUID();
  M.audio_fades.push({ id: fadeId, type: 'audio_fade', fade_type: 0, fade_in_duration: fadeInUs, fade_out_duration: fadeOutUs });
  return fadeId;
}

// ─── STEP 6: 오디오 트랙 빌드 (SKILL 규칙 준수) ────────────────────────────────
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

// ── Radio noise: 각 오프닝/DJ 리드인 sceneStart 시점에 NOISE_CLIP_US(2s) ──
// SEGMENT A: cursor=0에, SEGMENT C: story_end 직후에 배치
const radioNoiseSegs = [];
for (const block of timelineBlocks.filter(b => b.type === 'opening' || b.type === 'dj')) {
  const mat = makeSoundMat(REF.radio_noise, 'Radio noise');
  const aux = makeAudioAuxRefs();
  addAux(aux);
  M.audios.push(mat);
  radioNoiseSegs.push(makeAudioSegment({
    materialId: mat.id,
    start: block.sceneStart, dur: NOISE_CLIP_US,
    srcStart: 0, srcDur: NOISE_CLIP_US,
    volume: 1, extraRefs: aux.refs, trackRenderIndex: 5,
  }));
}

// PC click 트랙 (빈 배열로 유지 — 트랙 구조 호환)
const pcClickSegs = [];

// ── BGM: 각 사연 구간 — White In 시작 ~ Story TTS 종료, 루핑 ──
// SEGMENT B: bgmStart = sceneStart (White In 시작점), bgmEnd = ttsEnd
const track7Segs = [];
const bgmActualDurUs = REF.bgm.duration;
const BGM_MARGIN_US  = 10_000_000;
const BGM_SRC_DUR_US = Math.max(bgmActualDurUs - BGM_MARGIN_US, 1_000_000);
// 최소 1초 보장 — BGM 원본이 10초 이하여도 크래시 방지

for (const block of timelineBlocks.filter(b => b.type === 'story')) {
  const bgmStart = block.sceneStart;  // White In 시작점
  const bgmEnd   = block.ttsEnd;      // Story TTS 종료점

  let cur = bgmStart;
  while (cur < bgmEnd) {
    const remaining = bgmEnd - cur;
    const segDur    = Math.min(remaining, BGM_SRC_DUR_US);
    const mat = makeSoundMat(REF.bgm, 'BGM', 'music');
    const aux = makeAudioAuxRefs();
    addAux(aux);
    M.audios.push(mat);
    track7Segs.push(makeAudioSegment({
      materialId: mat.id,
      start: cur, dur: segDur,
      srcStart: 0, srcDur: segDur,
      volume: BGM_VOL, extraRefs: aux.refs, trackRenderIndex: 7,
    }));
    cur += segDur;
  }
}

// BGM source_timerange 초과 검증
for (const seg of track7Segs) {
  if (seg.source_timerange.duration > BGM_SRC_DUR_US) {
    console.error(`❌ BGM source_timerange 초과: ${seg.source_timerange.duration} > ${BGM_SRC_DUR_US}`);
    process.exit(1);
  }
}

// ── TTS: 각 block의 ttsStart 기준 배치 ──
const ttsSegs = [];
const ttsMats = [];

timelineBlocks.forEach((block, ti) => {
  const { chunk } = block;
  const filePath  = normPath(chunk.mp3Path);
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
  ttsSegs.push(makeAudioSegment({
    materialId: mat.id,
    start: block.ttsStart, dur: chunk.durUs,
    srcStart: 0, srcDur: chunk.durUs,
    volume: TTS_VOL, extraRefs: aux.refs, trackRenderIndex: 8 + ti,
  }));
  console.log(`  TTS [${ti+1}/${timelineBlocks.length}] ${chunk.chunkId}: t=${(block.ttsStart/1e6).toFixed(2)}s dur=${chunk.durSec.toFixed(2)}s`);
});
M.audios.push(...ttsMats);

// Radio noise 페이드 (in 300ms / out 300ms)
for (const seg of radioNoiseSegs) {
  const fadeId = makeAudioFade(300_000, 300_000);
  if (!seg.extra_material_refs) seg.extra_material_refs = [];
  seg.extra_material_refs.push(fadeId);
}

// BGM 페이드 (첫 클립 fade_in 1s / 마지막 클립 fade_out 1s)
for (let i = 0; i < track7Segs.length; i++) {
  const isFirst = i === 0;
  const isLast  = i === track7Segs.length - 1;
  const fadeId  = makeAudioFade(isFirst ? 1_000_000 : 0, isLast ? 1_000_000 : 0);
  if (!track7Segs[i].extra_material_refs) track7Segs[i].extra_material_refs = [];
  track7Segs[i].extra_material_refs.push(fadeId);
}

console.log(`  Radio noise: ${radioNoiseSegs.length}개 / BGM: ${track7Segs.length}개 / TTS: ${ttsSegs.length}개`);

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
  makeTrack('audio',   track7Segs),                                    // 6: BGM
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

  // BGM source_timerange 초과 검증 (BGM 트랙 세그먼트만 대상)
  const bgmOver = track7Segs.filter(s => s.source_timerange?.duration > BGM_SRC_DUR_US);
  if (bgmOver.length > 0)
    errors.push(`BGM source_timerange 초과 세그먼트 ${bgmOver.length}개`);

  // 이미지 material 연결 검증
  const videoSegsWithoutMat = videoSegs.filter(s => !s.material_id);
  if (videoSegsWithoutMat.length > 0)
    errors.push(`material_id 없는 비디오 세그먼트: ${videoSegsWithoutMat.length}개`);

  if (errors.length > 0) {
    console.error('\n❌ 검증 실패:');
    errors.forEach(e => console.error('   ' + e));
    process.exit(1);
  }

  // audio_fades 등록 수 로깅
  const fadedAudioSegs = draft.tracks
    .filter(t => t.type === 'audio')
    .flatMap(t => t.segments)
    .filter(s => s.extra_material_refs?.some(r =>
      draft.materials.audio_fades.some(f => f.id === r)
    ));
  console.log(`   오디오 페이드 적용: ${fadedAudioSegs.length}개 세그먼트`);
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

// ─── QA 검증 (SKILL 5대 편집 규칙 자동 검증) ────────────────────────────────
function validateTimeline(draft) {
  const errors  = [];
  const PAUSE_US = BREATHING_ROOM;  // 2초 여백 상수 (QA 수식용 별칭)
  const allEffectSegs  = draft.tracks.filter(t => t.type === 'effect').flatMap(t => t.segments);
  const allStickerSegs = draft.tracks.filter(t => t.type === 'sticker').flatMap(t => t.segments);

  // effect_id 역매핑 (material_id → effect_id)
  const veMap = {};
  for (const ve of draft.materials.video_effects) veMap[ve.id] = ve.effect_id;
  // QA 1: Radio noise 종료 <= DJ TTS 시작 (겹침 금지)
  for (const block of timelineBlocks.filter(b => b.type === 'opening' || b.type === 'dj')) {
    const radioEnd   = block.sceneStart + NOISE_CLIP_US;
    const djTtsStart = block.ttsStart;
    if (radioEnd > djTtsStart)
      errors.push(`QA1 [Overlap] ${block.chunk.chunkId}: radio_noise 종료(${(radioEnd/1e6).toFixed(3)}s) > DJ TTS 시작(${(djTtsStart/1e6).toFixed(3)}s)`);
  }

  // QA 2: EP 사연 씬 총 duration == (WHITE_IN_DUR + story_tts_dur + PAUSE_US) ±1ms
  for (const block of timelineBlocks.filter(b => b.type === 'story')) {
    const storyScenes   = sceneTimeline.filter(s => s._chunk === block.chunk.chunkId);
    const totalImgDur   = storyScenes.reduce((sum, s) => sum + s._dur, 0);
    const expectedSceneDur = WHITE_IN_DUR + block.chunk.durUs + PAUSE_US;
    if (Math.abs(totalImgDur - expectedSceneDur) > 1000)
      errors.push(`QA2 [Duration] EP${block.ep} story: 이미지 총 dur ${totalImgDur}µs ≠ 예상 ${expectedSceneDur}µs (delta ${totalImgDur - expectedSceneDur}µs)`);
  }

  // QA 3: WAVE 스티커 + 레트로 플리커 == 정확히 DJ TTS 구간
  for (const block of timelineBlocks.filter(b => b.type === 'opening' || b.type === 'dj')) {
    const djStart = block.ttsStart;
    const djDur   = block.chunk.durUs;

    const matchBN = allEffectSegs.find(s =>
      veMap[s.material_id] === RETRO_FLICKER_EFFECT_ID &&
      s.target_timerange.start === djStart &&
      s.target_timerange.duration === djDur
    );
    if (!matchBN)
      errors.push(`QA3 [Sync] ${block.chunk.chunkId}: 레트로 플리커가 DJ TTS 구간(${(djStart/1e6).toFixed(2)}s, ${(djDur/1e6).toFixed(2)}s)과 불일치`);

    const matchStk = allStickerSegs.find(s =>
      s.target_timerange.start === djStart &&
      s.target_timerange.duration === djDur
    );
    if (!matchStk)
      errors.push(`QA3 [Sync] ${block.chunk.chunkId}: WAVE 스티커가 DJ TTS 구간(${(djStart/1e6).toFixed(2)}s)과 불일치`);
  }

  // QA 4: 이전 TTS 종료 + PAUSE_US == White In 시작 (breathing room 삽입 검증)
  const storyBlocks = timelineBlocks.filter(b => b.type === 'story');
  for (const block of storyBlocks) {
    const blockIdx  = timelineBlocks.indexOf(block);
    const prevBlock = blockIdx > 0 ? timelineBlocks[blockIdx - 1] : null;
    if (prevBlock) {
      const whiteInStart     = block.sceneStart;
      const expectedWIStart  = prevBlock.ttsEnd + PAUSE_US;
      if (Math.abs(whiteInStart - expectedWIStart) > 1000)
        errors.push(`QA4 [Sync] EP${block.ep}: White In 시작(${(whiteInStart/1e6).toFixed(3)}s) ≠ 이전 TTS 종료+2s(${(expectedWIStart/1e6).toFixed(3)}s)`);
    }
    // White In 종료 == Story TTS 시작 (구조적 보증)
    const whiteInEnd = block.sceneStart + WHITE_IN_DUR;
    if (Math.abs(whiteInEnd - block.ttsStart) > 1)
      errors.push(`QA4 [Sync] EP${block.ep}: White In 종료(${(whiteInEnd/1e6).toFixed(3)}s) ≠ Story TTS 시작(${(block.ttsStart/1e6).toFixed(3)}s)`);
  }

  // QA 5: Noise Out 시작 == 마지막 TTS 종료 + PAUSE_US (2초 암전 아웃트로 검증)
  const lastTtsEnd  = timelineBlocks[timelineBlocks.length - 1].ttsEnd;
  const expectedNOS = lastTtsEnd + PAUSE_US;
  if (Math.abs(noiseOutStart - expectedNOS) > 1000)
    errors.push(`QA5 [Outro] Noise Out 시작(${(noiseOutStart/1e6).toFixed(3)}s) ≠ 마지막 TTS 종료+2s(${(expectedNOS/1e6).toFixed(3)}s)`);

  // QA 6: 사연 BGM start <= White In start AND BGM end >= Story TTS end
  for (const block of timelineBlocks.filter(b => b.type === 'story')) {
    const bgmForBlock = track7Segs.filter(s =>
      s.target_timerange.start >= block.sceneStart &&
      s.target_timerange.start < block.ttsEnd
    );
    if (bgmForBlock.length === 0) {
      errors.push(`QA6 [BGM] EP${block.ep}: BGM 세그먼트 없음`);
      continue;
    }
    const bgmStart = Math.min(...bgmForBlock.map(s => s.target_timerange.start));
    const bgmEnd   = Math.max(...bgmForBlock.map(s => s.target_timerange.start + s.target_timerange.duration));
    if (bgmStart > block.sceneStart)
      errors.push(`QA6 [BGM] EP${block.ep}: BGM 시작(${(bgmStart/1e6).toFixed(2)}s) > White In 시작(${(block.sceneStart/1e6).toFixed(2)}s)`);
    if (bgmEnd < block.ttsEnd)
      errors.push(`QA6 [BGM] EP${block.ep}: BGM 종료(${(bgmEnd/1e6).toFixed(2)}s) < Story TTS 종료(${(block.ttsEnd/1e6).toFixed(2)}s)`);
  }

  if (errors.length > 0) {
    errors.forEach(e => console.error('❌ QA FAIL:', e));
    process.exit(1);
  }
  console.log('✅ QA ALL PASSED: 모든 5대 편집 규칙 및 아웃트로 연출 완벽 적용 완료.');
}

// 검증 (QA 타임라인 → 기존 구조 검증 순)
validateTimeline(newDraft);
validate(newDraft);

// ─── 저장 (기존: capcut_output/) ─────────────────────────────────────────────
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(newDraft, null, 2), 'utf-8');

// ─── 라우팅: CapCut 드래프트 폴더로 직접 배송 ────────────────────────────────
{
  const DRAFTS_DIR = process.env.CAPCUT_DRAFTS_DIR;
  if (!DRAFTS_DIR || !fs.existsSync(DRAFTS_DIR)) {
    console.error('❌ CAPCUT_DRAFTS_DIR가 .env에 없거나 경로가 유효하지 않습니다.');
    process.exit(1);
  }

  // 1. 타겟 폴더명 생성 (Radio_EP_YYYYMMDD_HHMMSS)
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const folderName = `Radio_EP_${stamp}`;
  const targetDir  = path.join(DRAFTS_DIR, folderName);
  fs.mkdirSync(targetDir, { recursive: true });

  // 2. 껍데기(meta_info) 로드
  const metaTemplatePath = path.join(__dirname, 'master_template', 'draft_meta_info.json');
  if (!fs.existsSync(metaTemplatePath)) {
    console.error('❌ master_template/draft_meta_info.json 없음');
    console.error('   먼저 실행: node .radio_output/run_00_extract_meta.mjs');
    process.exit(1);
  }
  const metaInfo = JSON.parse(fs.readFileSync(metaTemplatePath, 'utf-8'));

  // 3. Root UUID 발급
  const rootUUID = newUUID();

  // 4. 껍데기 갱신
  metaInfo.id             = rootUUID;
  metaInfo.draft_name     = folderName;
  metaInfo.draft_fold_path = normPath(targetDir);

  // 5. 알맹이 동기화 (newDraft.id에 동일 UUID 주입)
  newDraft.id = rootUUID;

  // 6. 최종 배송
  fs.writeFileSync(
    path.join(targetDir, 'draft_meta_info.json'),
    JSON.stringify(metaInfo, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(targetDir, 'draft_content.json'),
    JSON.stringify(newDraft, null, 2),
    'utf-8'
  );

  console.log(`\n🚀 CapCut 드래프트 배송 완료`);
  console.log(`   폴더: ${normPath(targetDir)}`);
  console.log(`   UUID: ${rootUUID}`);
}

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
