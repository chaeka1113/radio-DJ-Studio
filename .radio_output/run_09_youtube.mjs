/**
 * run_09_youtube.mjs
 * YouTube 업로드 에셋 자동 생성
 *
 * 1) Gemini 2.5 Pro → marketing_meta.json (제목 3종, 썸네일 텍스트, 설명란, 해시태그, 챕터)
 * 2) @napi-rs/canvas → thumb_A.png (노란 텍스트), thumb_B.png (빨간 텍스트)
 * 3) youtube_upload.txt, pinned_comment.txt 생성
 *
 * 필요 파일:
 *   - assets/master_base.png     (テンキ爺 마스터 이미지 1920×1080)
 *   - assets/fonts/NotoSansJP-Bold.otf
 */

import fs   from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { loadEnv }                               from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs }   from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

const ROOT        = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR  = path.join(ROOT, 'assets');
const FONT_PATH   = path.join(ASSETS_DIR, 'fonts', 'NotoSansJP-Bold.otf');
const BASE_IMG    = path.join(ASSETS_DIR, 'master_base.png');
const YOUTUBE_DIR = path.join(P.base, 'youtube');
fs.mkdirSync(YOUTUBE_DIR, { recursive: true });

// ─── 폰트 등록 ────────────────────────────────────────────────────────────────
if (!fs.existsSync(FONT_PATH)) {
  console.error(`❌ 폰트 없음: ${FONT_PATH}`);
  process.exit(1);
}
GlobalFonts.registerFromPath(FONT_PATH, 'NotoSansJP');
console.log('✅ NotoSansJP 폰트 등록 완료');

// ─── 소스 데이터 로드 ─────────────────────────────────────────────────────────
const scriptsPath  = P.scripts;
const djPath       = P.djScript;
const qaPath       = P.qaScript;

if (!fs.existsSync(scriptsPath)) { console.error('❌ 01_scripts.json 없음'); process.exit(1); }
if (!fs.existsSync(djPath))      { console.error('❌ 02_dj_script.json 없음'); process.exit(1); }

const scripts  = JSON.parse(fs.readFileSync(scriptsPath, 'utf-8'));
const djScript = JSON.parse(fs.readFileSync(djPath, 'utf-8'));
const qaScript = fs.existsSync(qaPath) ? JSON.parse(fs.readFileSync(qaPath, 'utf-8')) : null;

// 스토리보드 — 씬 이미지 선택용 (없으면 master_base fallback)
const allScenes = fs.existsSync(P.storyboard)
  ? JSON.parse(fs.readFileSync(P.storyboard, 'utf-8')).scenes
  : [];
// 스토리 씬만 (DJ_SHOT 제외), globalIdx = SC###.png 번호 기준 (0-based)
const storyScenes = allScenes
  .map((s, i) => ({ ...s, globalIdx: i }))
  .filter(s => s.type !== 'DJ_SHOT');

// ─── 챕터 타임스탬프 계산 ─────────────────────────────────────────────────────
function secToMmss(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// CapCut draft_content.json에서 MP3 파일별 TTS 시작 시간(초) 추출
function readTtsStartTimes(draftPath) {
  if (!fs.existsSync(draftPath)) return {};
  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf-8'));
  const idToFile = {};
  for (const a of (draft.materials?.audios ?? [])) {
    if (a.path) idToFile[a.id] = a.path.replace(/\\/g, '/').split('/').pop();
  }
  const ttsStart = {};
  for (const track of (draft.tracks ?? [])) {
    if (track.type !== 'audio') continue;
    for (const seg of (track.segments ?? [])) {
      const fname = idToFile[seg.material_id];
      if (!fname) continue;
      const sec = seg.target_timerange.start / 1_000_000;
      if (ttsStart[fname] === undefined || sec < ttsStart[fname])
        ttsStart[fname] = sec;
    }
  }
  return ttsStart;
}

// 07_qa_and_closing timestamps에서 outro 시작 오프셋(초) 계산
// 구조: intro(1 seg) + qa_pairs(qaCount × 2 seg) + outro(마지막 seg)
function calcOutroOffset(audioDir, qaCount) {
  const tsFile = path.join(audioDir, '07_qa_and_closing_timestamps.json');
  if (!fs.existsSync(tsFile)) return 0;
  const ts = JSON.parse(fs.readFileSync(tsFile, 'utf-8'));
  const silence  = ts.silence_sec ?? 0;
  const TRAILING = 0.3;
  const outroIdx = 1 + qaCount * 2;  // intro(1) + qa_pairs(N×2)
  const segs = ts.segments ?? [];
  let cumul = 0;
  for (let i = 0; i < Math.min(outroIdx, segs.length); i++) {
    const s = segs[i];
    const ends   = s?.alignment?.character_end_times_seconds ?? [];
    const lastEnd = ends.length > 0 ? ends[ends.length - 1] : 0;
    const segDur  = (s.duration_sec > 0 && s.duration_sec >= lastEnd - 0.05)
      ? s.duration_sec : (lastEnd > 0 ? lastEnd + TRAILING : 0);
    cumul += segDur + silence;
  }
  return cumul;
}

function buildChapters(audioDir, draftPath, dj, hasQa, qaScript) {
  const tts = readTtsStartTimes(draftPath);
  const t   = (f) => tts[f] ?? 0;

  const LEAD     = 2.0;   // Radio noise lead-in
  const WHITE_IN = 2.3;   // White In lead-in

  const eps = dj.episodes || [];
  const chapters = [];

  // 1. Opening: scene start = 0:00 (리드인 포함 전체 시작)
  chapters.push({ label: '🎙️ オープニング', sec: 0 });

  // 2~4. EP1~3: scene start = TTS 시작 - WHITE_IN
  if (eps[0]) chapters.push({ label: `📖 EP1「${eps[0].title || eps[0].theme}」`, sec: Math.max(0, t('01_ep1_story.mp3') - WHITE_IN) });
  if (eps[1]) chapters.push({ label: `📖 EP2「${eps[1].title || eps[1].theme}」`, sec: Math.max(0, t('03_ep2_story.mp3') - WHITE_IN) });
  if (eps[2]) chapters.push({ label: `📖 EP3「${eps[2].title || eps[2].theme}」`, sec: Math.max(0, t('05_ep3_story.mp3') - WHITE_IN) });

  // 5~6. Q&A / Ending
  const closingSceneStart = Math.max(0, t('07_qa_and_closing.mp3') - LEAD);
  if (hasQa && qaScript) {
    chapters.push({ label: '❓ Q&Aコーナー', sec: closingSceneStart });
    const qaCount    = (qaScript.qa_pairs || []).length;
    const outroOffset = calcOutroOffset(audioDir, qaCount);
    chapters.push({ label: '🎵 エンディング', sec: t('07_qa_and_closing.mp3') + outroOffset });
  } else {
    chapters.push({ label: '🎵 エンディング', sec: closingSceneStart });
  }

  console.log('📐 챕터 타임스탬프:');
  chapters.forEach(c => console.log(`   ${secToMmss(Math.round(c.sec))} ${c.label}`));

  return chapters.map(c => `${secToMmss(Math.round(Math.max(0, c.sec)))} ${c.label}`).join('\n');
}

const capcutDraftPath = path.join(P.capcut, 'draft_content.json');
const chapterText = buildChapters(P.audio, capcutDraftPath, djScript, !!qaScript, qaScript);
const epSummaries = (scripts.episodes || []).map(ep =>
  `EP${ep.id}「${ep.title}」— ${(ep.script || '').slice(0, 60).replace(/\n/g,' ')}…`
).join('\n');

// ─── Gemini 2.5 Pro API 호출 ──────────────────────────────────────────────────
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.error('❌ GEMINI_API_KEY 없음'); process.exit(1); }

const GEMINI_MODEL = 'gemini-2.5-pro';

function geminiRequest(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.0, responseMimeType: 'application/json' },
    });
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path:     `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          // 코드블록 제거 후 파싱
          const clean = text.replace(/```json\n?|\n?```/g, '').trim();
          const obj = JSON.parse(clean);
          // Gemini가 배열이나 번호 키 객체로 반환할 경우 첫 값 추출
          if (Array.isArray(obj)) resolve(obj[0]);
          else if (obj['0']) resolve(obj['0']);
          else resolve(obj);
        } catch (e) {
          reject(new Error(`Gemini 파싱 실패: ${e.message}\n응답: ${raw.slice(0,300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 에피소드별 스토리 씬 목록 (Gemini 씬 선택용)
const sceneListByEp = {};
for (const s of storyScenes) {
  const ep = s.episode_id ?? 'none';
  if (!sceneListByEp[ep]) sceneListByEp[ep] = [];
  sceneListByEp[ep].push(s);
}
const sceneListText = Object.entries(sceneListByEp).map(([ep, scenes]) => {
  const lines = scenes.map(s =>
    `  [idx=${s.globalIdx}] ${s.type}: ${(s.visual_prompt_en || '').slice(0, 80)}`
  ).join('\n');
  return `【EP${ep} シーン一覧】\n${lines}`;
}).join('\n\n');

const MARKETING_PROMPT = `
あなたは日本のYouTubeマーケティング専門家です。
以下は「テンキ爺の電波局」という1本のラジオ番組動画（3エピソード収録）のメタデータを生成してください。

【DJ プロフィール】
テンキ爺: 70代・元エンジニアの毒舌AI老人ラジオDJ。人間への共感ゼロ、因果関係だけで動く機械的思考。

【本日のエピソード一覧】
${epSummaries}

【スト리보드シーン一覧 — thumb画像選定用】
各シーンのidxはSC{idx+1:03d}.pngに対応する。hero_epのシーンの中からのみ選ぶこと。
${sceneListText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【出力JSON構造 — このまま1つだけ返せ】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "hero_ep": {
    "id": "最も視聴者の感情を動かすエピソードのID (1/2/3)",
    "reason": "選んだ理由を日本語で一文"
  },
  "title_A": "【衝撃系】Hero Epの具体的数字/事件+テンキ爺の毒舌 — 40字以内・必ず【】始まり",
  "title_B": "「キャラ台詞系」テンキ爺の口調で視聴者に直接ツッコミ — 40字以内・必ず「」始まり",
  "title_C": "共感系・問いかけ形式・視聴者の不安を突く — 40字以内",
  "thumb_angry": {
    "main": "Hero Epの最衝撃ファクト(数字優先) — 絶対8字以内",
    "sub": "事件の文脈を補足する一言 — 絶対12字以内",
    "scene_idx": "title_Aの衝撃・사건강조 분위기に最も合うシーンのidx(整数)"
  },
  "thumb_calm": {
    "main": "後悔・哀愁・喪失感を表す言葉 — 絶対8字以内",
    "sub": "老後・孤独・後悔テーマの補足 — 絶対12字以内",
    "scene_idx": "title_Cの共感・감성 분위기に最も合うシーンのidx(整数)"
  },
  "thumb_surprise": {
    "main": "反転・驚き・ツンデレを表す言葉 — 絶対8字以内",
    "sub": "視聴者の好奇心を煽る補足 — 絶対12字以内",
    "scene_idx": "title_Bの反転・캐릭터 분위기に最も合うシーンのidx(整数)"
  },
  "hashtags": ["#昭和レトロ", "#人生相談", "#老後", "#毒舌ラジオ", "#テンキ爺"],
  "description_jp": "動画説明欄。Hero EPの最も衝撃的な一文(事実・数字強調)を冒頭に置くこと。絵文字込み・タイムスタンプ不要・チャンネル登録促進含む・150字以内",
  "description_kr": "上記の韓国語訳・150字以内"
}

【Hero Episode 選定優先順位】
1순위: 具体的な金額損失・詐欺・退職金喪失など数字で表現できる事件
2순위: 家族・嫁姑・職場の裏切り/理不尽で感情が激化するもの
3순위: 孤独・後悔・老後の喪失感で共感性が高いもの

【thumb テキスト品質基準】
- main: インパクト最優先・数字があれば必ず入れる・句読点なし
- sub: mainの文脈補足・「〜の末路」「〜前日に発覚」「〜を知らなかった」形式推奨
- 3種のthumb_main・subはすべて異なる切り口で書くこと(コピー禁止)

【scene_idx 選定基準】
- thumb_angry: 사건の瞬間・충격적인 표정・対立シーン優先
- thumb_calm: 고독・후회・눈물・회상 シーン優先 (FLASHBACKタイプ推奨)
- thumb_surprise: 반전・의외の 행동・ツンデレ 표정 シーン優先
- 3つのscene_idxはすべて異なる値にすること
- hero_epのシーン一覧に存在するidxのみ使用すること

厳守事項:
- JSONオブジェクト1つのみ返す(配列・複数オブジェクト禁止)
- title_A は【】、title_B は「」で始める
- thumb各mainは8字以内、subは12字以内・絶対厳守
- scene_idxは整数値(文字列不可)
- hashtags 5個固定
- マークダウン・説明文不要・JSONのみ
`.trim();

console.log('\n🤖 Gemini 2.5 Pro — 마케팅 메타 생성 중...');
let meta;
try {
  meta = await geminiRequest(MARKETING_PROMPT);
  console.log('✅ 마케팅 메타 생성 완료');
  console.log(`   hero_ep:    EP${meta.hero_ep?.id} — ${meta.hero_ep?.reason}`);
  console.log(`   title_A:    ${meta.title_A}`);
  console.log(`   title_B:    ${meta.title_B}`);
  console.log(`   title_C:    ${meta.title_C}`);
  console.log(`   thumb_angry:    main="${meta.thumb_angry?.main}" / sub="${meta.thumb_angry?.sub}" / scene_idx=${meta.thumb_angry?.scene_idx}`);
  console.log(`   thumb_calm:     main="${meta.thumb_calm?.main}" / sub="${meta.thumb_calm?.sub}" / scene_idx=${meta.thumb_calm?.scene_idx}`);
  console.log(`   thumb_surprise: main="${meta.thumb_surprise?.main}" / sub="${meta.thumb_surprise?.sub}" / scene_idx=${meta.thumb_surprise?.scene_idx}`);
} catch (e) {
  console.error(`❌ Gemini 실패: ${e.message}`);
  process.exit(1);
}

// marketing_meta.json 저장
const marketingMeta = { ...meta, chapters: chapterText, generated_at: new Date().toISOString() };
fs.writeFileSync(path.join(YOUTUBE_DIR, 'marketing_meta.json'), JSON.stringify(marketingMeta, null, 2), 'utf-8');
console.log('✅ marketing_meta.json 저장 완료');

// ─── youtube_upload.txt 생성 ──────────────────────────────────────────────────
const hashtagStr = (meta.hashtags || []).join(' ');

// Hero EP 정보
const heroEpId  = meta.hero_ep?.id ?? '?';
const heroEp    = (scripts.episodes || []).find(e => String(e.id) === String(heroEpId));
const heroTitle = heroEp?.title ?? `EP${heroEpId}`;
const heroReason = meta.hero_ep?.reason ?? '';

// 썸네일 선택 가이드
const thumbGuide = [
  `  thumb_angry.png   → [A 사건강조] main="${meta.thumb_angry?.main}"  /  sub="${meta.thumb_angry?.sub}"`,
  `  thumb_calm.png    → [B 감성후회] main="${meta.thumb_calm?.main}"  /  sub="${meta.thumb_calm?.sub}"`,
  `  thumb_surprise.png→ [C 반전호기] main="${meta.thumb_surprise?.main}"  /  sub="${meta.thumb_surprise?.sub}"`,
].join('\n');

const uploadTxt = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⭐ HERO EPISODE — EP${heroEpId}「${heroTitle}」
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
선정 이유: ${heroReason}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 추천 제목 3종 (골라서 사용)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[A 사건강조형] ${meta.title_A}
[B 캐릭터대사] ${meta.title_B}
[C 공감형]     ${meta.title_C}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🖼  썸네일 선택 가이드 (3장 중 1장 선택)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${thumbGuide}

💡 제목 A → thumb_angry.png / 제목 B → thumb_calm.png / 제목 C → thumb_surprise.png 조합 권장

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 설명란 (복붙용) — 일본어
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${meta.description_jp}

${chapterText}

${hashtagStr}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🇰🇷 설명란 — 한국어 (커뮤니티·번역 채널용)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${meta.description_kr || ''}

${chapterText}

${hashtagStr}
`.trim();

fs.writeFileSync(path.join(YOUTUBE_DIR, 'youtube_upload.txt'), uploadTxt, 'utf-8');
console.log('✅ youtube_upload.txt 저장 완료');

// ─── pinned_comment.txt 생성 ─────────────────────────────────────────────────
const pinnedTxt = `
📌 チャプター / 타임스탬프

${chapterText}

━━━━━━━━━━━━━
💬 今夜のエピソードはどれが刺さった？コメントで教えろ、このバカ野郎！
チャンネル登録&高評価でワシのラジオが続けられるんだ。分かったらさっさと押せ。
`.trim();

fs.writeFileSync(path.join(YOUTUBE_DIR, 'pinned_comment.txt'), pinnedTxt, 'utf-8');
console.log('✅ pinned_comment.txt 저장 완료');

// ─── 썸네일 렌더링 Configuration ──────────────────────────────────────────────
const THUMB_CONFIG = {
  W: 1280,
  H: 720,
  // 텍스트 열 위치
  TEXT_START_X_RATIO: 0.44,   // 텍스트 시작 X (전체 너비 대비)
  TEXT_AREA_W_RATIO:  0.53,   // 텍스트 최대 너비 (전체 너비 대비)
  // 폰트 크기
  MAIN_FONT_MAX:  310,        // 최대 폰트 (단어 수 적을수록 이 값에 근접)
  MAIN_FONT_MIN:  72,         // 최소 폰트 (텍스트가 매우 길 때 하한)
  MAIN_FONT_STEP: 4,          // 축소 단위
  SUB_FONT_RATIO: 0.40,       // sub 크기 = main 크기 × 이 값
  // 레이아웃
  SUB_GAP:      16,           // main 하단 ~ sub 상단 간격(px) — 이 간격의 중간점이 이미지 Y 정중앙
  // 3단 레이어 렌더링 파라미터
  STROKE_RATIO: 0.20,         // stroke lineWidth = fontSize × 이 값 — 굵은 고딕체 느낌
  STROKE_MIN:   22,           // stroke 최소값(px) — 작은 폰트에서도 굵게
  SHADOW_BLUR:  22,
  SHADOW_X:     6,
  SHADOW_Y:     6,
  // 감정별 색상 팔레트 (A/B 테스트 시 여기만 수정)
  // grad[0] = 그라디언트 시작 X비율 — 0.667이면 이미지 오른쪽 1/3 구간에 색 오버레이
  EMOTION_PALETTE: {
    angry:    { main: '#FFC700', sub: '#FF7A00', grad: [0.667, 'rgba(60,0,0,0.75)',  'rgba(20,0,0,0.88)']  },
    calm:     { main: '#3DC8FF', sub: '#B8ECFF', grad: [0.667, 'rgba(0,20,60,0.75)', 'rgba(0,10,40,0.88)'] },
    surprise: { main: '#4CFF57', sub: '#FFFF66', grad: [0.667, 'rgba(0,40,20,0.75)', 'rgba(0,20,10,0.88)'] },
  },
};

const { W, H, EMOTION_PALETTE } = THUMB_CONFIG;
const TEXT_X     = W * THUMB_CONFIG.TEXT_START_X_RATIO;
const TEXT_MAX_W = W * THUMB_CONFIG.TEXT_AREA_W_RATIO;

// Bounding Box 기반 Auto-Scaling: MAIN_FONT_MAX 에서 시작해 박스에 맞을 때까지 축소
function fitFontSize(ctx, text, maxWidth) {
  const { MAIN_FONT_MAX, MAIN_FONT_MIN, MAIN_FONT_STEP } = THUMB_CONFIG;
  let size = MAIN_FONT_MAX;
  while (size > MAIN_FONT_MIN) {
    ctx.font = `bold ${size}px NotoSansJP`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= MAIN_FONT_STEP;
  }
  return Math.max(size, MAIN_FONT_MIN);
}

// 3단 레이어 렌더링: ① Drop Shadow → ② 두꺼운 검은 Stroke → ③ 색상 Fill
function drawHeroText(ctx, text, x, y, fontSize, fillColor) {
  const { STROKE_RATIO, STROKE_MIN, SHADOW_BLUR, SHADOW_X, SHADOW_Y } = THUMB_CONFIG;
  const strokeW = Math.max(STROKE_MIN, Math.round(fontSize * STROKE_RATIO));

  ctx.font         = `bold ${fontSize}px NotoSansJP`;
  ctx.textBaseline = 'top';
  ctx.lineJoin     = 'round';

  // Layer 1: Drop Shadow 부착 상태로 Stroke
  ctx.shadowColor   = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur    = SHADOW_BLUR;
  ctx.shadowOffsetX = SHADOW_X;
  ctx.shadowOffsetY = SHADOW_Y;
  ctx.strokeStyle   = '#000000';
  ctx.lineWidth     = strokeW;
  ctx.strokeText(text, x, y);

  // Layer 2: Shadow 제거 후 Stroke 재도포 (테두리 선명도 강화)
  ctx.shadowColor = 'transparent';
  ctx.strokeText(text, x, y);

  // Layer 3: Fill
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
}

function drawSubText(ctx, text, x, y, subSize, subColor) {
  const strokeW = Math.max(8, Math.round(subSize * THUMB_CONFIG.STROKE_RATIO));

  ctx.font         = `bold ${subSize}px NotoSansJP`;
  ctx.textBaseline = 'top';
  ctx.lineJoin     = 'round';

  ctx.shadowColor   = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;
  ctx.strokeStyle   = '#000000';
  ctx.lineWidth     = strokeW;
  ctx.strokeText(text, x, y);

  ctx.shadowColor = 'transparent';
  ctx.fillStyle   = subColor;
  ctx.fillText(text, x, y);
}

async function buildThumbnail({ emotion, basePath, mainText, subText, outPath, label }) {
  process.stdout.write(`🖼  ${label} 생성 중... `);

  // basePath(씬 이미지) → 없으면 master_base_{emotion} → 없으면 BASE_IMG 순으로 fallback
  const sceneFile   = basePath && fs.existsSync(basePath) ? basePath : null;
  const masterFile  = path.join(ASSETS_DIR, `master_base_${emotion}.png`);
  const fallback    = path.join(ASSETS_DIR, 'master_base_angry.png');
  const baseImg     = sceneFile ?? (fs.existsSync(masterFile) ? masterFile : (fs.existsSync(fallback) ? fallback : BASE_IMG));
  if (sceneFile) process.stdout.write(`[씬:${path.basename(basePath)}] `);
  const base        = await loadImage(baseImg);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // ── 1. 베이스 이미지 중앙 크롭 ───────────────────────────────────────────
  const scale = Math.max(W / base.width, H / base.height);
  const dw    = base.width * scale, dh = base.height * scale;
  ctx.drawImage(base, (W - dw) / 2, (H - dh) / 2, dw, dh);

  // ── 2. 감정 색조 그라디언트 오버레이 ─────────────────────────────────────
  const pal  = EMOTION_PALETTE[emotion] ?? EMOTION_PALETTE.angry;
  const grad = ctx.createLinearGradient(W * pal.grad[0], 0, W, 0);
  grad.addColorStop(0,   'rgba(0,0,0,0)');
  grad.addColorStop(0.3, pal.grad[1]);
  grad.addColorStop(1,   pal.grad[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ── 3. main + sub 텍스트 — 두 텍스트 간격의 중간점이 이미지 Y축 정중앙
  const mainSize = fitFontSize(ctx, mainText, TEXT_MAX_W);
  const subSize  = Math.round(mainSize * THUMB_CONFIG.SUB_FONT_RATIO);
  const MAIN_Y   = H / 2 - THUMB_CONFIG.SUB_GAP / 2 - mainSize;
  const SUB_Y    = H / 2 + THUMB_CONFIG.SUB_GAP / 2;
  drawHeroText(ctx, mainText, TEXT_X, MAIN_Y, mainSize, pal.main);
  drawSubText(ctx, subText, TEXT_X, SUB_Y, subSize, pal.sub);

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  console.log(`✅ (${emotion} / main:${mainSize}px sub:${subSize}px / ${(buf.length/1024).toFixed(0)} KB)`);
}

// scene_idx → SC###.png 경로 변환 (없으면 undefined → fallback)
const sceneIdxToPath = (idx) => {
  if (idx == null || idx < 0 || idx >= allScenes.length) return undefined;
  const scNum = String(idx + 1).padStart(3, '0');
  return path.join(P.images, `SC${scNum}.png`);
};

// 3종 썸네일 생성
const THUMBS = [
  {
    emotion:  'angry',
    basePath: sceneIdxToPath(meta.thumb_angry?.scene_idx),
    mainText: meta.thumb_angry?.main   ?? '衝撃の事実',
    subText:  meta.thumb_angry?.sub    ?? 'テンキ爺が斬る',
    outPath:  path.join(YOUTUBE_DIR, 'thumb_angry.png'),
    label:    '① angry (팩트/충격)',
  },
  {
    emotion:  'calm',
    basePath: sceneIdxToPath(meta.thumb_calm?.scene_idx),
    mainText: meta.thumb_calm?.main    ?? 'もう遅い...',
    subText:  meta.thumb_calm?.sub     ?? '老後の孤独と絶望',
    outPath:  path.join(YOUTUBE_DIR, 'thumb_calm.png'),
    label:    '② calm (감성/후회)',
  },
  {
    emotion:  'surprise',
    basePath: sceneIdxToPath(meta.thumb_surprise?.scene_idx),
    mainText: meta.thumb_surprise?.main ?? 'まさかの真実',
    subText:  meta.thumb_surprise?.sub  ?? '定年前日に判明',
    outPath:  path.join(YOUTUBE_DIR, 'thumb_surprise.png'),
    label:    '③ surprise (반전/호기심)',
  },
];

for (const t of THUMBS) await buildThumbnail(t);

// ─── 완료 보고 ────────────────────────────────────────────────────────────────
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ STEP 09 완료 — YouTube 에셋 생성 완료
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 ${YOUTUBE_DIR}
   marketing_meta.json   ← Hero EP 선정 + 제목 3종
   youtube_upload.txt    ← 제목/설명/챕터/썸네일가이드 복붙용
   pinned_comment.txt    ← 고정 댓글 복붙용
   thumb_angry.png       ← ① 팩트/충격 (노란 메인)
   thumb_calm.png        ← ② 감성/후회 (하늘 메인)
   thumb_surprise.png    ← ③ 반전/호기심 (민트 메인)

⭐ Hero EP: ${heroEpId} — ${heroTitle}
`);
