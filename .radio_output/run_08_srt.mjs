/**
 * run_08_srt.mjs
 * 1) draft_content.json 타임라인 → subtitles.srt (CapCut 완전 동기화)
 * 2) 에피소드 draft_content.json에 자막 text 트랙 직접 삽입
 *    (마스터 템플릿 C:/radio-dj-studio/draft_content.json 스타일 기준)
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { loadEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

const MAX_CHARS    = 22;
const MASTER_JSON  = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'draft_content.json');
const newUUID      = () => randomUUID().toUpperCase();
const toUs         = (sec) => Math.round(sec * 1_000_000);

// ─── SRT 시간 포맷 ────────────────────────────────────────────────────────────
function toSrtTime(sec) {
  const ms  = Math.round(sec * 1000);
  const h   = Math.floor(ms / 3_600_000);
  const m   = Math.floor((ms % 3_600_000) / 60_000);
  const s   = Math.floor((ms % 60_000) / 1_000);
  const mss = ms % 1_000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(mss).padStart(3,'0')}`;
}

// ─── 마스터 템플릿에서 스타일 추출 ───────────────────────────────────────────
let STYLE = null;
if (fs.existsSync(MASTER_JSON)) {
  try {
    const master    = JSON.parse(fs.readFileSync(MASTER_JSON, 'utf-8'));
    const masterMat = master.materials?.texts?.[0];
    const masterSeg = master.tracks?.find(t => t.type === 'text')?.segments?.[0];
    if (masterMat && masterSeg) {
      const parsedContent = JSON.parse(masterMat.content);
      STYLE = {
        // 폰트
        fontPath:          parsedContent.styles[0].font.path,
        fontSize:          masterMat.font_size,
        textSize:          masterMat.text_size,
        boldWidth:         masterMat.bold_width,
        // 색상
        textColor:         masterMat.text_color,
        // 외곽선
        borderWidth:       masterMat.border_width,
        borderColor:       masterMat.border_color,
        borderMode:        masterMat.border_mode,
        // 배경
        bgStyle:           masterMat.background_style,
        bgAlpha:           masterMat.background_alpha,
        bgColor:           masterMat.background_color,
        bgWidth:           masterMat.background_width,
        bgHeight:          masterMat.background_height,
        // 레이아웃
        alignment:         masterMat.alignment,
        lineSpacing:       masterMat.line_spacing,
        lineMaxWidth:      masterMat.line_max_width,
        fixedWidth:        masterMat.fixed_width,
        // 위치/크기 (세그먼트 clip)
        clip:              masterSeg.clip,
        renderIndex:       masterSeg.render_index,
        trackRenderIndex:  masterSeg.track_render_index,
      };
      console.log('✅ 마스터 템플릿 스타일 로드 완료');
    }
  } catch (e) {
    console.warn(`⚠️  마스터 템플릿 파싱 실패: ${e.message}`);
  }
}

if (!STYLE) {
  console.warn('⚠️  마스터 템플릿 없음 — 기본 스타일 사용');
  STYLE = {
    fontPath:     '',
    fontSize:     5,
    textSize:     30,
    boldWidth:    0.008,
    textColor:    '#ffffff',
    borderWidth:  0.2,
    borderColor:  '#000000',
    borderMode:   0,
    bgStyle:      1,
    bgAlpha:      1,
    bgColor:      '#000000',
    bgWidth:      0.14,
    bgHeight:     0.14,
    alignment:    1,
    lineSpacing:  0.02,
    lineMaxWidth: 0.82,
    fixedWidth:   1029.22,
    clip: {
      scale: { x: 0.7, y: 0.7 }, rotation: 0,
      transform: { x: 0, y: -0.95 },
      flip: { vertical: false, horizontal: false }, alpha: 1,
    },
    renderIndex:      14002,
    trackRenderIndex: 5,
  };
}

// ─── STEP 1: draft_content.json → 파일명:시작시간(초) 매핑 ───────────────────
const capcutPath = path.join(P.capcut, 'draft_content.json');
if (!fs.existsSync(capcutPath)) {
  console.error(`❌ draft_content.json 없음: ${capcutPath}`);
  process.exit(1);
}

const draft = JSON.parse(fs.readFileSync(capcutPath, 'utf-8'));

const idToFile = {};
for (const audio of (draft.materials?.audios ?? [])) {
  if (audio.id && audio.path) {
    const fname = audio.path.replace(/\\/g, '/').split('/').pop();
    idToFile[audio.id] = fname;
  }
}

const fileToStart = {};
for (const track of (draft.tracks ?? [])) {
  if (track.type !== 'audio') continue;
  for (const seg of (track.segments ?? [])) {
    const tr  = seg.target_timerange;
    const mid = seg.material_id;
    if (!tr || !mid) continue;
    const fname = idToFile[mid];
    if (!fname) continue;
    const startSec = tr.start / 1_000_000;
    if (fileToStart[fname] === undefined || startSec < fileToStart[fname]) {
      fileToStart[fname] = startSec;
    }
  }
}

const mapped = Object.keys(fileToStart).sort((a, b) => fileToStart[a] - fileToStart[b]);
console.log(`\n📍 CapCut 타임라인 오프셋 (${mapped.length}개 파일):`);
mapped.forEach(f => console.log(`   ${f.padEnd(30)} → ${fileToStart[f].toFixed(2)}s`));

// ─── STEP 2: timestamps.json → 전체 문자 배열 ────────────────────────────────
const audioDir = P.audio;
if (!fs.existsSync(audioDir)) {
  console.error(`❌ audio 디렉토리 없음: ${audioDir}`);
  process.exit(1);
}

const tsFiles = fs.readdirSync(audioDir)
  .filter(f => f.endsWith('_timestamps.json'))
  .sort();

if (tsFiles.length === 0) {
  console.error('❌ *_timestamps.json 없음');
  process.exit(1);
}

console.log(`\n📂 타임스탬프 파일 ${tsFiles.length}개:`);
let allChars = [];

for (const tsFile of tsFiles) {
  const mp3Name   = tsFile.replace('_timestamps.json', '.mp3');
  const capOffset = fileToStart[mp3Name];
  if (capOffset === undefined) {
    console.warn(`   ⚠️  ${mp3Name} → 타임라인에 없음 (스킵)`);
    continue;
  }
  console.log(`   ${mp3Name.padEnd(30)} offset=${capOffset.toFixed(2)}s`);

  const tsData   = JSON.parse(fs.readFileSync(path.join(audioDir, tsFile), 'utf-8'));
  const segments = Array.isArray(tsData.segments) ? tsData.segments
                 : Array.isArray(tsData)           ? tsData
                 : [];

  let segSubOffset = 0;
  for (const seg of segments) {
    const ali    = seg.alignment ?? seg;
    const chars  = ali.characters ?? [];
    const starts = ali.character_start_times_seconds ?? [];
    const ends   = ali.character_end_times_seconds   ?? [];
    for (let i = 0; i < chars.length; i++) {
      allChars.push({
        char:  chars[i],
        start: (starts[i] ?? 0) + capOffset + segSubOffset,
        end:   (ends[i]   ?? 0) + capOffset + segSubOffset,
      });
    }
    segSubOffset += ends.length > 0 ? ends[ends.length - 1] : 0;
  }
}

console.log(`\n📝 총 문자 수: ${allChars.length}`);

// ─── STEP 3: [audio_tag] 필터링 ──────────────────────────────────────────────
let filtered = [];
let insideTag = false;
for (const c of allChars) {
  if (c.char === '[') { insideTag = true;  continue; }
  if (c.char === ']') { insideTag = false; continue; }
  if (insideTag || c.char.trim() === '') continue;
  filtered.push(c);
}
console.log(`📝 태그 필터 후 문자 수: ${filtered.length}`);

// ─── STEP 4: 자막 라인 분할 ──────────────────────────────────────────────────
const SENTENCE_END = new Set(['。', '！', '？', '…', '♪']);
const SOFT_BREAK   = new Set(['、', '・', '，']);

function buildSubtitles(chars) {
  const subs = [];
  let lineChars = [];
  function flush() {
    if (!lineChars.length) return;
    const text = lineChars.map(c => c.char).join('').trim();
    if (text) subs.push({ start: lineChars[0].start, end: lineChars[lineChars.length-1].end, text });
    lineChars = [];
  }
  for (const c of chars) {
    lineChars.push(c);
    if (SENTENCE_END.has(c.char))                          { flush(); continue; }
    if (lineChars.length >= MAX_CHARS && SOFT_BREAK.has(c.char)) { flush(); continue; }
    if (lineChars.length >= MAX_CHARS * 2)                 { flush(); }
  }
  flush();
  return subs;
}

const subtitles = buildSubtitles(filtered);
console.log(`📋 자막 라인 수: ${subtitles.length}`);

// ─── STEP 5: SRT 저장 ────────────────────────────────────────────────────────
const srtLines = subtitles.map((s, i) => {
  const endTime = Math.max(s.end, s.start + 0.8);
  return `${i+1}\n${toSrtTime(s.start)} --> ${toSrtTime(endTime)}\n${s.text}`;
});
const srtPath = path.join(P.base, 'subtitles.srt');
fs.writeFileSync(srtPath, srtLines.join('\n\n') + '\n', 'utf-8');
const totalSec = subtitles.length > 0 ? subtitles[subtitles.length-1].end : 0;
console.log(`\n✅ SRT 저장 완료 → ${srtPath}`);
console.log(`   총 ${subtitles.length}개 자막 | 마지막 자막 ${toSrtTime(totalSec)}`);

// ─── STEP 6: draft_content.json 에 text 트랙 직접 삽입 ───────────────────────
console.log('\n📝 draft_content.json 자막 트랙 삽입 중...');

const groupId  = `srt_${Date.now()}`;
const newTexts = [];
const newAnims = [];
const newSegs  = [];

for (const sub of subtitles) {
  const textId = newUUID();
  const animId = newUUID();
  const segId  = newUUID();
  const endSec = Math.max(sub.end, sub.start + 0.8);
  const dur    = endSec - sub.start;

  // content JSON (텍스트 + 스타일)
  const contentObj = {
    text: sub.text,
    styles: [{
      fill:   { content: { render_type: 'solid', solid: { color: [1,1,1] } } },
      font:   { path: STYLE.fontPath, id: '' },
      strokes: [{
        content: { render_type: 'solid', solid: { color: [0,0,0] } },
        width: STYLE.borderWidth,
        mode:  STYLE.borderMode,
      }],
      size:           STYLE.fontSize,
      bold:           true,
      useLetterColor: true,
      range:          [0, sub.text.length],
    }],
  };

  // texts material
  newTexts.push({
    recognize_task_id: '', id: textId, name: '', recognize_text: '',
    recognize_model: '', punc_model: '',
    type: 'subtitle',
    content: JSON.stringify(contentObj),
    base_content: '',
    words: { start_time: [], end_time: [], text: [] },
    current_words: { start_time: [], end_time: [], text: [] },
    global_alpha: 1,
    combo_info: { text_templates: [] },
    caption_template_info: {
      resource_id:'', third_resource_id:'', resource_name:'',
      category_id:'', category_name:'', effect_id:'', request_id:'',
      path:'', is_new: false, source_platform: 0,
    },
    layer_weight: 1,
    letter_spacing: 0,
    text_curve: null, text_loop_on_path: false, offset_on_path: 0,
    enable_path_typesetting: false, text_exceeds_path_process_type: 0,
    text_typesetting_paths: null, text_typesetting_paths_file: '',
    text_typesetting_path_index: 0,
    line_spacing:        STYLE.lineSpacing,
    has_shadow: false, shadow_color: '', shadow_alpha: 0.9,
    shadow_smoothing: 0.45, shadow_distance: 5,
    shadow_point: { x: 0.636, y: -0.636 },
    shadow_angle: -45,
    shadow_thickness_projection_enable: false,
    shadow_thickness_projection_angle: 0,
    shadow_thickness_projection_distance: 0,
    border_alpha:        1,
    border_color:        STYLE.borderColor,
    border_width:        STYLE.borderWidth,
    border_mode:         STYLE.borderMode,
    style_name: '',
    text_color:          STYLE.textColor,
    text_alpha: 1,
    font_name: '', font_title: 'none',
    font_size:           STYLE.fontSize,
    font_path:           STYLE.fontPath,
    font_id: '', font_resource_id: '', initial_scale: 1,
    font_url: '', typesetting: 0,
    alignment:           STYLE.alignment,
    line_feed: 1,
    use_effect_default_color: true,
    is_rich_text: false, shape_clip_x: false, shape_clip_y: false,
    ktv_color: '', text_to_audio_ids: [],
    bold_width:          STYLE.boldWidth,
    italic_degree: 0, underline: false, underline_width: 0, underline_offset: 0,
    sub_type: 0, check_flag: 15,
    text_size:           STYLE.textSize,
    font_category_name: '', font_source_platform: 0,
    font_third_resource_id: '', font_category_id: '',
    add_type: 2, operation_type: 0, recognize_type: 0, fonts: [],
    background_color:    STYLE.bgColor,
    background_alpha:    STYLE.bgAlpha,
    background_style:    STYLE.bgStyle,
    background_round_radius: 0,
    background_width:    STYLE.bgWidth,
    background_height:   STYLE.bgHeight,
    background_vertical_offset: 0, background_horizontal_offset: 0,
    background_fill: '',
    single_char_bg_enable: false, single_char_bg_color: '', single_char_bg_alpha: 1,
    single_char_bg_round_radius: 0.3, single_char_bg_width: 0, single_char_bg_height: 0,
    single_char_bg_vertical_offset: 0, single_char_bg_horizontal_offset: 0,
    font_team_id: '', tts_auto_update: false,
    text_preset_resource_id: '',
    group_id: groupId,
    preset_id: '', preset_name: '', preset_category: '', preset_category_id: '',
    preset_index: 0, preset_has_set_alignment: false,
    force_apply_line_max_width: false,
    language: '', relevance_segment: [], original_size: [],
    fixed_width:         STYLE.fixedWidth,
    fixed_height: -1,
    line_max_width:      STYLE.lineMaxWidth,
    oneline_cutoff: false, cutoff_postfix: '',
    subtitle_template_original_fontsize: 0, subtitle_keywords: null,
    inner_padding: -1, multi_language_current: 'none', source_from: '',
    is_lyric_effect: false, lyric_group_id: '',
    lyrics_template: {
      resource_id:'', resource_name:'', panel:'', effect_id:'',
      path:'', category_id:'', category_name:'', request_id:'',
    },
    is_batch_replace: false, is_words_linear: false, ssml_content: '',
    subtitle_keywords_config: null, sub_template_id: -1, translate_original_text: '',
  });

  // material_animations (빈 애니메이션)
  newAnims.push({
    id: animId,
    type: 'sticker_animation',
    animations: [],
    multi_language_current: 'none',
  });

  // text track 세그먼트
  newSegs.push({
    id:               segId,
    source_timerange: null,
    target_timerange: { start: toUs(sub.start), duration: toUs(dur) },
    render_timerange: { start: 0, duration: 0 },
    desc: '', state: 0, speed: 1,
    is_loop: false, is_tone_modify: false, reverse: false,
    intensifies_audio: false, cartoon: false, volume: 1, last_nonzero_volume: 1,
    clip: STYLE.clip,
    uniform_scale: { on: true, value: 1 },
    material_id:          textId,
    extra_material_refs:  [animId],
    render_index:         STYLE.renderIndex,
    keyframe_refs: [], enable_lut: false, enable_adjust: false, enable_hsl: false,
    visible: true, group_id: '',
    enable_color_curves: true, enable_hsl_curves: true,
    track_render_index:   STYLE.trackRenderIndex,
    hdr_settings: null, enable_color_wheels: true, track_attribute: 0,
    is_placeholder: false, template_id: '',
    enable_smart_color_adjust: false, template_scene: 'default',
    common_keyframes: [], caption_info: null,
    responsive_layout: {
      enable: false, target_follow: '', size_layout: 0,
      horizontal_pos_layout: 0, vertical_pos_layout: 0,
    },
    enable_color_match_adjust: false, enable_color_correct_adjust: false,
    enable_adjust_mask: false, raw_segment_id: '', lyric_keyframes: null,
    enable_video_mask: true, digital_human_template_group_id: '',
    color_correct_alg_result: '', source: 'segmentsourcenormal',
    enable_mask_stroke: false, enable_mask_shadow: false,
    enable_color_adjust_pro: false,
  });
}

// 기존 text 트랙 제거 후 새 트랙 삽입
draft.tracks = (draft.tracks ?? []).filter(t => t.type !== 'text');
draft.tracks.splice(2, 0, {   // video 트랙 2개 뒤에 삽입 (CapCut 일반적 순서)
  attribute: 0,
  flag: 0,
  id: newUUID(),
  is_default_name: true,
  name: '',
  segments: newSegs,
  type: 'text',
});

// materials 에 추가
draft.materials.texts            = newTexts;
draft.materials.material_animations = [
  ...(draft.materials.material_animations ?? []),
  ...newAnims,
];

const draftJson = JSON.stringify(draft);
fs.writeFileSync(capcutPath, draftJson, 'utf-8');
console.log(`✅ draft_content.json 자막 트랙 삽입 완료 (${newSegs.length}개 세그먼트)`);

// ─── STEP 7: 실제 CapCut 프로젝트 디렉토리에도 동기화 ─────────────────────────
const capcutProjectDirFile = path.join(P.base, 'capcut_project_dir.txt');
if (fs.existsSync(capcutProjectDirFile)) {
  try {
    const projectDir = fs.readFileSync(capcutProjectDirFile, 'utf-8').trim();
    let synced = false;

    // 메인 draft_content.json
    const mainPath = path.join(projectDir, 'draft_content.json');
    if (fs.existsSync(mainPath)) {
      fs.writeFileSync(mainPath, draftJson, 'utf-8');
      console.log(`✅ CapCut 프로젝트 동기화: ${mainPath}`);
      synced = true;
    }

    // Timelines 서브 폴더
    const timelinesDir = path.join(projectDir, 'Timelines');
    if (fs.existsSync(timelinesDir)) {
      for (const sub of fs.readdirSync(timelinesDir)) {
        const subPath = path.join(timelinesDir, sub, 'draft_content.json');
        if (fs.existsSync(subPath)) {
          fs.writeFileSync(subPath, draftJson, 'utf-8');
          console.log(`✅ CapCut Timelines 동기화: ${subPath}`);
          synced = true;
        }
      }
    }

    if (!synced) console.warn(`⚠️  CapCut 프로젝트 경로에 draft_content.json 없음: ${projectDir}`);
  } catch (e) {
    console.warn(`⚠️  CapCut 동기화 오류: ${e.message}`);
  }
} else {
  console.warn('⚠️  capcut_project_dir.txt 없음 — CapCut 동기화 스킵 (run_06 재실행 필요)');
}

// 미리보기
console.log('\n--- 자막 미리보기 (첫 5개) ---');
srtLines.slice(0, 5).forEach(l => console.log(l + '\n'));
