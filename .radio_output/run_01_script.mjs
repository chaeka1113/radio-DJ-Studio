import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 로드 (루트 기준)
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }

const allArgs = process.argv.slice(2);
const includeMz = allArgs.includes('--mz');
const topics = allArgs.filter(a => !a.startsWith('--'));
if (topics.length < 3) { console.error('❌ 주제 3개 필요'); process.exit(1); }

// MZ 모드: contract가 있으면 거기서 mzEpNum 읽기, 없으면 랜덤
const contractPath = path.join(__dirname, 'ref_episode_contract.json');
const contract = fs.existsSync(contractPath) ? JSON.parse(fs.readFileSync(contractPath, 'utf-8')) : null;
const mzEpNum = includeMz
  ? (contract?.mz_episode_id ?? Math.floor(Math.random() * 3) + 1)
  : null;
if (includeMz) console.log(`🔥 MZ 모드 ON — EP${mzEpNum}를 10~30대 사연자로 설정`);

// QA 피드백 로드 (재작업 시 이전 QA 피드백 주입)
const feedbackPath = path.join(__dirname, '01_qa_feedback.json');
const qaFeedback = fs.existsSync(feedbackPath)
  ? JSON.parse(fs.readFileSync(feedbackPath, 'utf-8'))
  : null;
if (qaFeedback) console.log('🔄 [재작업] QA 피드백 감지 — 수정 지시 반영');

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_script_rules.md'), 'utf-8');
const scriptRubric = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_script_rubric.md'), 'utf-8');

// ── 영구 오답 노트 로드 (존재할 때만) ────────────────────────────────────────
const learningsPath = path.join(__dirname, '../.claude/skills/ref_learnings.md');
const pastLearnings = fs.existsSync(learningsPath) ? fs.readFileSync(learningsPath, 'utf-8') : null;
if (pastLearnings) console.log('🧠 [Learnings] 과거 실수 모음 주입 완료');

// ── 전역 상태 초기화 ───────────────────────────────────────────────────────────
console.log('🗑  이전 작업물 초기화 중...');
const JSON_FILES = [
  '01_scripts.json', '02_dj_script.json', '03_character_prompts.json',
  '04_storyboard.json', '05_image_results.json', '06_video_results.json',
  '08_qa_script.json',
];
for (const f of JSON_FILES) {
  const p = path.join(__dirname, f);
  if (fs.existsSync(p)) { fs.rmSync(p); console.log(`   삭제: ${f}`); }
}
for (const d of ['images', 'videos']) {
  const p = path.join(__dirname, d);
  if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); console.log(`   폴더 삭제: ${d}/`); }
}
console.log('✅ 초기화 완료\n');

const client = new Anthropic({ apiKey: API_KEY });

const mzInstruction = includeMz ? `
【MZ世代 特別사연 — 절대 준수】
3개의 사연 중 EP${mzEpNum}의 사연자는 반드시 10대~30대(10代〜30代)의 젊은 세대로 설정해라.
나이는 22歳, 28歳 등 구체적으로 명시할 것.
가장 중요한 것은, 사용자가 입력한 EP${mzEpNum}의 테마(「${topics[mzEpNum - 1]}」)를 절대 바꾸지 말고 유지하되,
그 테마를 10~30대의 현실적이고 구체적인 상황(취업 스트레스, 직장 번아웃, 연애/결혼 압박, タイムパフォーマンス, SNS 비교 등)으로 재해석해서 작성해라.
나머지 2개 에피소드는 50대 이상 시니어로 유지해라.
` : `
【연령 설정】
사연자 3명 모두 50대 이상의 시니어층으로 설정해라.
`;

const prompt = `
${referenceKnowledge}

---

# 🚨 QA 채점 사전 경고 — 반드시 숙지할 것

당신이 작성한 대본은 생성 직후 아래 가중치 평가표에 따라 항목별로 깐깐하게 채점된다.
커트라인 85점 미만이면 Fail 처리되고 재작업이 강제된다.
특히 40점짜리 감점 항목(일본어 지문 사용, 계약 불이행)을 원천 차단하여 생성하라.

${scriptRubric}

${pastLearnings ? `---

【과거 실수 모음 — 절대 반복 금지】
아래는 이전 방송 회차에서 실제로 발생한 실수들을 압축 정리한 오답 노트다.
같은 실수를 한 번이라도 반복하면 QA에서 즉시 감점된다. 반드시 숙지하라.

${pastLearnings}
` : ''}---

あなたは「テンキ爺の電波局」専属シナリオライターです。
以下の3テーマで、ラジオ投稿エピソードを各1本執筆してください。
${mzInstruction}

テーマ1: ${topics[0]}
テーマ2: ${topics[1]}
テーマ3: ${topics[2]}
${contract ? `
【📋 計画書 制約 — QA 通過のため必ず守ること】
${(contract.episodes || []).map(ep => {
  const kws   = (ep.required_keywords || []).join('、');
  const vHint = ep.villain_required === true
    ? '빌런(is_villain=true) 캐릭터 필수'
    : ep.villain_required === false
      ? '빌런 없이 평범한 주인공(is_villain=false)'
      : '';
  const tone  = ep.required_emotion_tone ? `감정 톤 「${ep.required_emotion_tone}」` : '';
  const parts = [kws ? `키워드 최소 1개: [${kws}]` : '', vHint, tone].filter(Boolean).join(' / ');
  return parts ? `EP${ep.id}: ${parts}` : '';
}).filter(Boolean).join('\n')}
` : ''}${qaFeedback ? `
【⚠️ QA 재작업 지시 — 반드시 수정할 것】
이전 대본이 가중치 품질 검증(커트라인 85점)에서 실패했습니다.
총점: ${qaFeedback.score ?? '?'}/100
아래 감점 사유와 즉각적 수정 행동을 반드시 반영하여 재작성해라.

[감점 요약]
${(qaFeedback.feedback || []).map((f, i) => `${i + 1}. ${f}`).join('\n')}

[에피소드별 수정 지시]
${(qaFeedback.episodes || []).filter(e => !e.pass).map(e => {
  const issues = (e.issues || []).join(' / ');
  const actionable = (e.actionable_feedback || []).join(' / ');
  return `EP${e.id} (${e.rubric_score ?? '?'}점):\n  감점: ${issues || '없음'}\n  수정 행동: ${actionable || issues || '없음'}`;
}).join('\n')}

위 수정 행동을 완전히 적용 후 출력할 것. 같은 실수를 반복하면 안 된다.
` : ''}
【出力 JSON のみ返答】
{
  "episodes": [
    {
      "id": 1,
      "theme": "テーマ名（日本語）",
      "title": "エピソードタイトル",
      "script": "사연자 편지 본문만 800〜1,000文字",
      "emotion_tone": "苦笑い|哀愁|懐かしさ|ほっこり",
      "character": {
        "name": "主人公名（仮名）",
        "age": "推定年齢（例: 67歳）",
        "gender": "男性|女性",
        "personality_type": "頑固じじい|天邪鬼|自己中|意地っ張り|老害|心配性|普通の善人",
        "personality_desc": "성격 한줄 묘사 (일본어)",
        "setting": "舞台・時代背景",
        "is_villain": true,
        "flaw_trigger": "진상 행동 요약 (빌런이면 필수, 평범이면 null)"
      }
    },
    { "id": 2 },
    { "id": 3 }
  ]
}`;

console.log('📝 대본 생성 중 (Claude API)...');

let retryCount = 0;
let data;
while (retryCount < 3) {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const parsed = JSON.parse(jsonMatch[0]);
    // script 필드에 DJ 대사/로봇 의성어 오염 여부만 검사 (（）는 일본어 자연 표현이므로 허용)
    const scriptTexts = (parsed.episodes || []).map(ep => ep.script || '').join('\n');
    if (/ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(scriptTexts)) {
      throw new Error('규칙 위반: script 필드에 금지된 의성어 포함됨');
    }
    data = parsed;
    break;
  } catch (err) {
    retryCount++;
    console.warn(`⚠️ 재시도 ${retryCount}/3: ${err.message}`);
    if (retryCount >= 3) { console.error('❌ 최대 재시도 초과'); process.exit(1); }
  }
}

fs.writeFileSync(path.join(__dirname, '01_scripts.json'), JSON.stringify(data, null, 2), 'utf-8');

console.log('✅ 대본 생성 완료');
data.episodes.forEach(ep => {
  const villain = ep.character?.is_villain ? '🔴빌런' : '🟢평범';
  console.log(`   EP${ep.id} [${ep.theme}] "${ep.title}" — ${villain} ${ep.character?.personality_type}`);
  if (ep.character?.flaw_trigger) console.log(`      └ flaw: ${ep.character.flaw_trigger}`);
});
