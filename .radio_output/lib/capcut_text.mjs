/**
 * lib/capcut_text.mjs — CapCut 자막 유틸리티 (Shorts 파이프라인 전용)
 *
 * ElevenLabs 캐릭터 타임스탬프 → CapCut text material / segment / track 변환.
 */

import { randomUUID } from 'crypto';

const newUUID = () => randomUUID().toUpperCase();
const toUs    = (sec) => Math.round(sec * 1_000_000);

export const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '…']);
export const SOFT_BREAK   = new Set(['、', ',']);
export const MAX_CHARS    = 18;

/** 마스터 템플릿 materials.texts[0]을 기본 스타일로 반환 */
export function loadTextStyle(tmats) {
  return (tmats?.texts ?? [])[0] ?? null;
}

/** baseStyle 복제, id/content만 교체 */
export function buildTextMaterial(text, baseStyle) {
  const id = newUUID();
  if (!baseStyle) {
    return {
      id, type: 'text', content: text,
      check_flag: 0, text_to_audio_ids: [],
      recognize_task_id: '', word_infos: [], lyrics: [],
      subtitle_keywords: null,
    };
  }
  return { ...baseStyle, id, content: text };
}

/**
 * ElevenLabs 캐릭터 정렬 → 자막 스팬 배열.
 * @returns {{ text: string, start_us: number, end_us: number }[]}
 */
export function buildSubtitles(chars, startTimes, endTimes) {
  const spans = [];
  let buf = '';
  let bufStart = -1;
  let bufEnd   = 0;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const st = startTimes[i] ?? 0;
    const et = endTimes[i]   ?? 0;

    if (!ch.trim() && !buf) continue;

    if (bufStart < 0 && st > 0) bufStart = st;
    buf += ch;
    if (et > 0) bufEnd = et;

    const sentEnd = SENTENCE_END.has(ch);
    const softBrk = SOFT_BREAK.has(ch) && buf.replace(/\s/g, '').length >= Math.floor(MAX_CHARS * 0.7);
    const tooLong = buf.replace(/\s/g, '').length >= MAX_CHARS;
    const isLast  = i === chars.length - 1;

    if ((sentEnd || softBrk || tooLong || isLast) && buf.trim()) {
      spans.push({
        text:     buf.trim(),
        start_us: toUs(bufStart < 0 ? 0 : bufStart),
        end_us:   toUs(bufEnd),
      });
      buf      = '';
      bufStart = -1;
    }
  }

  return spans;
}

function buildTextSegment({ materialId, start, dur, extraRefs }) {
  return {
    id:               newUUID(),
    source_timerange: null,
    target_timerange: { start, duration: dur },
    render_timerange: { start: 0, duration: 0 },
    desc: '', state: 0, speed: 1,
    is_loop: false, is_tone_modify: false, reverse: false,
    intensifies_audio: false, cartoon: false,
    volume: 1, last_nonzero_volume: 1,
    clip: null, uniform_scale: null,
    material_id:         materialId,
    extra_material_refs: extraRefs,
    render_index:        14002,
    keyframe_refs:       [],
    enable_lut: false, enable_adjust: false, enable_hsl: false,
    visible: true, group_id: '',
    enable_color_curves: true, enable_hsl_curves: true,
    track_render_index:  14002,
    hdr_settings:        null,
    enable_color_wheels: true,
    track_attribute: 0, is_placeholder: false,
    template_id: '', enable_smart_color_adjust: false,
    template_scene: 'default',
    common_keyframes: [], caption_info: null,
    responsive_layout: {
      enable: false, target_follow: '', size_layout: 0,
      horizontal_pos_layout: 0, vertical_pos_layout: 0,
    },
    enable_color_match_adjust:   false,
    enable_color_correct_adjust: false,
    enable_adjust_mask:          false,
    raw_segment_id:              '',
    lyric_keyframes:             null,
    enable_video_mask:           true,
    digital_human_template_group_id: '',
    color_correct_alg_result:    '',
    source:                      'segmentsourcenormal',
    enable_mask_stroke:  false,
    enable_mask_shadow:  false,
    enable_color_adjust_pro: false,
  };
}

/**
 * 자막 스팬 → CapCut text 트랙 + 소재 목록.
 * @param {number} offsetUs — 타임라인 오프셋 (ttsStart)
 * @returns {{ textMaterials, matAnimations, track }}
 */
export function buildTextTrack(spans, offsetUs, baseStyle) {
  const textMaterials = [];
  const matAnimations = [];
  const textSegments  = [];

  for (const span of spans) {
    const dur = span.end_us - span.start_us;
    if (dur <= 0) continue;

    const mat    = buildTextMaterial(span.text, baseStyle);
    const animId = newUUID();

    textMaterials.push(mat);
    matAnimations.push({
      id: animId, type: 'sticker_animation',
      animations: [], multi_language_current: 'none',
    });
    textSegments.push(buildTextSegment({
      materialId: mat.id,
      start:      offsetUs + span.start_us,
      dur,
      extraRefs:  [animId],
    }));
  }

  return {
    textMaterials,
    matAnimations,
    track: {
      id:              newUUID(),
      type:            'text',
      segments:        textSegments,
      flag:            0,
      attribute:       0,
      name:            'Subtitles',
      is_default_name: false,
    },
  };
}
