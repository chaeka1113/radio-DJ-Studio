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

// ─── 챕터 타임스탬프 계산 ─────────────────────────────────────────────────────
function secToMmss(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// 실제 오디오 timestamps JSON으로 mp3 duration 읽기
function getAudioDuration(audioDir, stem) {
  const tsFile = path.join(audioDir, `${stem}_timestamps.json`);
  if (fs.existsSync(tsFile)) {
    try {
      const ts = JSON.parse(fs.readFileSync(tsFile, 'utf-8'));
      const segs = ts.segments ?? [];
      for (let i = segs.length - 1; i >= 0; i--) {
        const ends = segs[i]?.alignment?.character_end_times_seconds ?? [];
        if (ends.length > 0) return ends[ends.length - 1];
      }
    } catch {}
  }
  // fallback: estimate from mp3 file size at 128kbps
  const mp3 = path.join(audioDir, `${stem}.mp3`);
  if (!fs.existsSync(mp3)) return 0;
  return fs.statSync(mp3).size / (128 * 1024 / 8);
}

function buildChapters(audioDir, dj, hasQa) {
  const SILENCE = 1.5; // FFmpeg 세그먼트 간 묵음
  const eps = dj.episodes || [];

  // 오디오 파일별 실제 재생 시간 수집
  const d = {
    opening:  getAudioDuration(audioDir, '00_opening'),
    ep1Story: getAudioDuration(audioDir, '01_ep1_story'),
    ep1Dj:    getAudioDuration(audioDir, '02_ep1_dj'),
    ep2Story: getAudioDuration(audioDir, '03_ep2_story'),
    ep2Dj:    getAudioDuration(audioDir, '04_ep2_dj'),
    ep3Story: getAudioDuration(audioDir, '05_ep3_story'),
    ep3Dj:    getAudioDuration(audioDir, '06_ep3_dj'),
    qaClose:  getAudioDuration(audioDir, '07_qa_and_closing'),
  };

  console.log('📐 오디오 실측 길이(초):',
    Object.entries(d).map(([k,v]) => `${k}=${v.toFixed(1)}`).join(', ')
  );

  const chapters = [];
  let t = 0;

  chapters.push({ label: '🎙️ オープニング', time: t });
  t += d.opening + SILENCE;

  if (eps[0]) {
    chapters.push({ label: `📖 EP1「${eps[0].title || eps[0].theme}」`, time: t });
    t += d.ep1Story + SILENCE + d.ep1Dj + SILENCE;
  }
  if (eps[1]) {
    chapters.push({ label: `📖 EP2「${eps[1].title || eps[1].theme}」`, time: t });
    t += d.ep2Story + SILENCE + d.ep2Dj + SILENCE;
  }
  if (eps[2]) {
    chapters.push({ label: `📖 EP3「${eps[2].title || eps[2].theme}」`, time: t });
    t += d.ep3Story + SILENCE + d.ep3Dj + SILENCE;
  }
  if (hasQa && d.qaClose > 0) {
    chapters.push({ label: '❓ Q&Aコーナー', time: t });
    // qa_and_closing 파일에서 약 75%가 QA, 25%가 엔딩으로 추정
    t += d.qaClose * 0.75;
  }
  chapters.push({ label: '🎵 エンディング', time: t });

  return chapters.map(c => `${secToMmss(Math.round(c.time))} ${c.label}`).join('\n');
}

const chapterText = buildChapters(P.audio, djScript, !!qaScript);
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

const MARKETING_PROMPT = `
あなたは日本のYouTubeマーケティング専門家です。
以下は「テンキ爺の電波局」という1本のラジオ番組動画（3エピソード収録）のメタデータを生成してください。

【DJ プロフィール】
テンキ爺: 70代・元エンジニアの毒舌AI老人ラジオDJ。人間への共感ゼロ、因果関係だけで動く機械的思考。

【本日のエピソード一覧】
${epSummaries}

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
    "sub": "事件の文脈を補足する一言 — 絶対12字以内"
  },
  "thumb_calm": {
    "main": "後悔・哀愁・喪失感を表す言葉 — 絶対8字以内",
    "sub": "老後・孤独・後悔テーマの補足 — 絶対12字以内"
  },
  "thumb_surprise": {
    "main": "反転・驚き・ツンデレを表す言葉 — 絶対8字以内",
    "sub": "視聴者の好奇心を煽る補足 — 絶対12字以内"
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

厳守事項:
- JSONオブジェクト1つのみ返す(配列・複数オブジェクト禁止)
- title_A は【】、title_B は「」で始める
- thumb各mainは8字以内、subは12字以内・絶対厳守
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
  console.log(`   thumb_angry:    main="${meta.thumb_angry?.main}" / sub="${meta.thumb_angry?.sub}"`);
  console.log(`   thumb_calm:     main="${meta.thumb_calm?.main}" / sub="${meta.thumb_calm?.sub}"`);
  console.log(`   thumb_surprise: main="${meta.thumb_surprise?.main}" / sub="${meta.thumb_surprise?.sub}"`);
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

// ─── 썸네일 생성 ─────────────────────────────────────────────────────────────
const W = 1280, H = 720;
const SAFE_BOT = H - 40;   // 하단 40px 안전구역 (ID 바 없음)
const TEXT_X   = W * 0.44; // 텍스트 시작 X
const TEXT_MAX_W = W * 0.53;

// 폰트 크기 자동 축소: maxWidth 초과 시 줄여서 1줄에 맞춤
function fitFontSize(ctx, text, maxWidth, startSize, minSize = 60) {
  let size = startSize;
  while (size >= minSize) {
    ctx.font = `bold ${size}px NotoSansJP`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 6;
  }
  return size;
}

// 텍스트 + 두꺼운 스트로크 + 드롭섀도우
function drawHeroText(ctx, text, x, y, fontSize, fillColor) {
  ctx.font         = `bold ${fontSize}px NotoSansJP`;
  ctx.textBaseline = 'top';
  ctx.lineJoin     = 'round';

  // 드롭 섀도우 (스트로크 뒤에 그림자 레이어)
  ctx.shadowColor   = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur    = 12;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;

  // 검은 테두리 (두껍게)
  ctx.strokeStyle = '#000000';
  ctx.lineWidth   = fontSize * 0.14;
  ctx.strokeText(text, x, y);

  // 섀도우 리셋 후 채우기
  ctx.shadowColor = 'transparent';
  ctx.fillStyle   = fillColor;
  ctx.fillText(text, x, y);
}

function drawSubText(ctx, text, x, y, subColor) {
  const subSize = 42;
  ctx.font         = `bold ${subSize}px NotoSansJP`;
  ctx.textBaseline = 'top';
  ctx.lineJoin     = 'round';

  ctx.shadowColor   = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur    = 6;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.strokeStyle = '#000000';
  ctx.lineWidth   = 8;
  ctx.strokeText(text, x, y);

  ctx.shadowColor = 'transparent';
  ctx.fillStyle   = subColor;
  ctx.fillText(text, x, y);
}

// 감정별 색상 팔레트
const EMOTION_PALETTE = {
  angry:    { main: '#FFD700', sub: '#FF8C00', grad: [0.35, 'rgba(60,0,0,0.85)',    'rgba(20,0,0,0.95)'] },
  calm:     { main: '#A8D8FF', sub: '#D0ECFF', grad: [0.35, 'rgba(0,20,60,0.85)',   'rgba(0,10,40,0.95)'] },
  surprise: { main: '#ADFFA8', sub: '#FFFFA0', grad: [0.35, 'rgba(0,40,20,0.85)',   'rgba(0,20,10,0.95)'] },
};

async function buildThumbnail({ emotion, mainText, subText, outPath, label }) {
  process.stdout.write(`🖼  ${label} 생성 중... `);

  const baseFile = path.join(ASSETS_DIR, `master_base_${emotion}.png`);
  const fallback = path.join(ASSETS_DIR, 'master_base_angry.png');
  const baseImg  = fs.existsSync(baseFile) ? baseFile : (fs.existsSync(fallback) ? fallback : BASE_IMG);
  const base     = await loadImage(baseImg);

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

  // ── 3. sub 텍스트 (상단 위치, 중간 크기) ─────────────────────────────────
  const SUB_Y    = H * 0.28;
  const MAIN_Y   = SUB_Y + 58; // sub 아래 바로 main
  drawSubText(ctx, subText, TEXT_X, SUB_Y, pal.sub);

  // ── 4. main 텍스트 (폰트 자동 축소, 초대형) ──────────────────────────────
  const mainSize = fitFontSize(ctx, mainText, TEXT_MAX_W, 170, 80);
  drawHeroText(ctx, mainText, TEXT_X, MAIN_Y, mainSize, pal.main);

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  console.log(`✅ (${emotion} / main:${mainSize}px / ${(buf.length/1024).toFixed(0)} KB)`);
}

// 3종 썸네일 생성
const THUMBS = [
  {
    emotion:  'angry',
    mainText: meta.thumb_angry?.main   ?? '衝撃の事実',
    subText:  meta.thumb_angry?.sub    ?? 'テンキ爺が斬る',
    outPath:  path.join(YOUTUBE_DIR, 'thumb_angry.png'),
    label:    '① angry (팩트/충격)',
  },
  {
    emotion:  'calm',
    mainText: meta.thumb_calm?.main    ?? 'もう遅い...',
    subText:  meta.thumb_calm?.sub     ?? '老後の孤独と絶望',
    outPath:  path.join(YOUTUBE_DIR, 'thumb_calm.png'),
    label:    '② calm (감성/후회)',
  },
  {
    emotion:  'surprise',
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
