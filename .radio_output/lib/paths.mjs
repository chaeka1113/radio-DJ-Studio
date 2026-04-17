/**
 * lib/paths.mjs — EP_ID 기반 경로 팩토리
 *
 * 핵심 철학: 모든 런타임 산출물은 .output/{EP_ID}/ 하위에 격리.
 * 스크립트(run_*.mjs)와 산출물(*.json, *.mp3, *.png)을 물리적으로 분리하여
 * 멀티 에피소드 동시 처리 시 데이터 간섭을 원천 차단.
 *
 * 불변 자산 (프로젝트 루트 또는 .radio_output/ 고정):
 *   - draft_content.json      ← CapCut 마스터 템플릿
 *   - ref_capcut_materials.json
 *   - master_template/
 *   - .claude/skills/ref_*.md ← 지식 베이스
 *
 * Usage:
 *   import { generateEpId, makePaths, ensureDirs } from '../lib/paths.mjs';
 *
 *   const epId = process.env.EP_ID ?? generateEpId();
 *   const P    = makePaths(epId);
 *   ensureDirs(P);
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** 프로젝트 루트 (radio-dj-studio/) */
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..'
);

/**
 * EP_YYYYMMDD_HHMM 형식의 에피소드 ID 생성.
 * 동일 분 안에 실행된 파이프라인은 같은 ID를 공유한다.
 */
export function generateEpId() {
  const now = new Date();
  const p   = (n, l = 2) => String(n).padStart(l, '0');
  return `EP_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
}

/**
 * EP_ID를 받아 해당 에피소드의 전체 경로 맵을 반환.
 * 모든 경로는 절대 경로(absolute path).
 *
 * @param {string} epId  예: "EP_20260411_1430"
 * @returns {Paths}
 */
export function makePaths(epId) {
  const base   = path.join(ROOT, '.output', epId);
  const skills = path.join(ROOT, '.claude', 'skills');

  return {
    // ── 루트 ──────────────────────────────────────────────────────────────
    root:   ROOT,
    base,   // .output/EP_YYYYMMDD_HHMM/

    // ── 에피소드 메타 ──────────────────────────────────────────────────────
    manifest:     path.join(base, 'manifest.json'),
    epContract:   path.join(base, 'ref_episode_contract.json'),

    // ── 파이프라인 산출물 (숫자 접두사 = 생성 순서) ────────────────────────
    trends:            path.join(base, '00_trends.json'),
    scripts:           path.join(base, '01_scripts.json'),
    qaFeedback:        path.join(base, '01_qa_feedback.json'),
    qaResult:          path.join(base, '01_qa_result.json'),
    djScript:          path.join(base, '02_dj_script.json'),
    characterPrompts:  path.join(base, '03_character_prompts.json'),
    characterSheet:    path.join(base, 'ref_character_sheet.json'),
    storyboard:        path.join(base, '04_storyboard.json'),
    storyboardSummary: path.join(base, '04_storyboard_summary.json'), // 경량 뷰
    visualQaResult:    path.join(base, '04_visual_qa_result.json'),
    imageResults:      path.join(base, '05_image_results.json'),
    qaScript:          path.join(base, '08_qa_script.json'),
    kenburnsResults:   path.join(base, '08_kenburns_results.json'),
    audioManifest:     path.join(base, '09_audio_manifest.json'),
    finalTtsScript:    path.join(base, 'final_script_for_tts.txt'),

    // ── 미디어 폴더 ────────────────────────────────────────────────────────
    images: path.join(base, 'images'),
    audio:  path.join(base, 'audio'),
    videos: path.join(base, 'videos'),
    capcut: path.join(base, 'capcut'),

    // ── 불변 지식 (.claude/skills/) ───────────────────────────────────────
    skills,
    learnings:       path.join(skills, 'ref_learnings.md'),
    refScript:       path.join(skills, 'ref_script_rules.md'),
    refScriptRubric: path.join(skills, 'ref_script_rubric.md'),
    refJapanFacts:   path.join(skills, 'ref_japan_facts.md'),
    refPersona:      path.join(skills, 'ref_persona_rules.md'),
    refVisual:       path.join(skills, 'ref_visual_rules.md'),
    refVisualRubric: path.join(skills, 'ref_visual_rubric.md'),
    refTts:          path.join(skills, 'ref_tts_v3_rules.md'),     // 전체 ElevenLabs 스펙 (944줄, 레퍼런스용)
    refTtsCore:      path.join(skills, 'ref_tts_v3_core.md'),      // 프로젝트 핵심 규칙만 (주입용)

    // ── 불변 CapCut 자산 ───────────────────────────────────────────────────
    capcutTemplate:  path.join(ROOT, 'draft_content_마스터_.json'),
    capcutMaterials: path.join(ROOT, '.radio_output', 'ref_capcut_materials.json'),
    masterTemplate:  path.join(ROOT, '.radio_output', 'master_template'),
  };
}

/**
 * 에피소드 산출물 디렉토리 일괄 생성.
 * 멱등(idempotent): 이미 존재해도 에러 없음.
 *
 * @param {ReturnType<typeof makePaths>} P
 */
export function ensureDirs(P) {
  for (const dir of [P.base, P.images, P.audio, P.videos, P.capcut]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * manifest.json 생성 (파이프라인 시작 시 한 번만 호출).
 * 이미 존재하면 stage 필드만 업데이트.
 *
 * @param {ReturnType<typeof makePaths>} P
 * @param {{ epId: string, topics: string[], qaMode: boolean }} meta
 */
export function initManifest(P, { epId, topics, qaMode }) {
  let manifest = {};
  if (fs.existsSync(P.manifest)) {
    manifest = JSON.parse(fs.readFileSync(P.manifest, 'utf-8'));
  }
  manifest = {
    ...manifest,
    ep_id:      epId,
    topics,
    qa_mode:    qaMode,
    stage:      manifest.stage ?? 'init',
    created_at: manifest.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    files: {
      trends:            P.trends,
      ep_contract:       P.epContract,
      scripts:           P.scripts,
      dj_script:         P.djScript,
      character_prompts: P.characterPrompts,
      storyboard:        P.storyboard,
      storyboard_summary:P.storyboardSummary,
      qa_script:         P.qaScript,
      audio_dir:         P.audio,
      images_dir:        P.images,
      capcut_dir:        P.capcut,
    },
  };
  fs.writeFileSync(P.manifest, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

/**
 * manifest.json의 stage 필드만 업데이트.
 *
 * @param {ReturnType<typeof makePaths>} P
 * @param {string} stage
 */
export function updateStage(P, stage) {
  if (!fs.existsSync(P.manifest)) return;
  const m = JSON.parse(fs.readFileSync(P.manifest, 'utf-8'));
  m.stage      = stage;
  m.updated_at = new Date().toISOString();
  fs.writeFileSync(P.manifest, JSON.stringify(m, null, 2), 'utf-8');
}
