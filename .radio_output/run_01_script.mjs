import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs, updateStage } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

const API_KEY = requireEnv('ANTHROPIC_API_KEY');

const allArgs = process.argv.slice(2);
const includeMz = allArgs.includes('--mz');
const topics = allArgs.filter(a => !a.startsWith('--'));
if (topics.length < 3) { console.error('❌ 주제 3개 필요'); process.exit(1); }

// MZ 모드: contract가 있으면 거기서 mzEpNum 읽기, 없으면 랜덤
const contract = fs.existsSync(P.epContract) ? JSON.parse(fs.readFileSync(P.epContract, 'utf-8')) : null;
const mzEpNum = includeMz
  ? (contract?.mz_episode_id ?? Math.floor(Math.random() * 3) + 1)
  : null;
if (includeMz) console.log(`🔥 MZ 모드 ON — EP${mzEpNum}를 10~30대 사연자로 설정`);

// QA 피드백 로드 (재작업 시 이전 QA 피드백 주입)
const qaFeedback = fs.existsSync(P.qaFeedback)
  ? JSON.parse(fs.readFileSync(P.qaFeedback, 'utf-8'))
  : null;
if (qaFeedback) console.log('🔄 [재작업] QA 피드백 감지 — 수정 지시 반영');

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(P.refScript, 'utf-8');
const scriptRubric = fs.readFileSync(P.refScriptRubric, 'utf-8');

// ── 영구 오답 노트 로드 (존재할 때만) ────────────────────────────────────────
const pastLearnings = fs.existsSync(P.learnings) ? fs.readFileSync(P.learnings, 'utf-8') : null;
if (pastLearnings) console.log('🧠 [Learnings] 과거 실수 모음 주입 완료');

// ── 전역 상태 초기화 ───────────────────────────────────────────────────────────
console.log('🗑  이전 작업물 초기화 중...');
const STALE_FILES = [
  P.scripts, P.djScript, P.characterPrompts,
  P.storyboard, P.storyboardSummary, P.imageResults,
  P.qaScript,
];
for (const fp of STALE_FILES) {
  if (fs.existsSync(fp)) { fs.rmSync(fp); console.log(`   삭제: ${fp.split('/').pop()}`); }
}
for (const d of [P.images, P.videos]) {
  if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); console.log(`   폴더 삭제: ${d.split('/').pop()}/`); }
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

// ── 공통 컨텍스트 블록 (모든 에피소드에 공통 주입) ────────────────────────────
const contextBlock = `
${referenceKnowledge}

---

🚨 분량 절대 준수 — QA 통과의 핵심 조건
각 사연(script 필드)은 반드시 800文字 이상 1,000文字 이하로 작성한다.
800文字 미만이면 QA에서 즉시 Fail 처리되어 전체 재작업이 강제된다.
분량을 채우는 방법:
- 사연자의 감정 변화를 단계별로 묘사한다 (처음엔 ~였는데, 그러다 ~, 결국 ~)
- 구체적인 날짜, 장소, 실제 대화 내용을 포함한다
- 주변 인물(배우자, 자녀, 직장 동료, 친구)의 반응과 대사를 묘사한다
- 사건 전후의 심경 변화와 자기 반성을 충분히 서술한다
- 편지 특유의 인사말과 마무리 문장으로 앞뒤를 감싼다

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
` : ''}`;

console.log('📝 대본 생성 중 (Claude API — 에피소드별 개별 호출)...');

const episodes = [];

for (let epIdx = 0; epIdx < 3; epIdx++) {
  const epNum = epIdx + 1;
  const topic = topics[epIdx];
  const cEp = (contract?.episodes || []).find(e => e.id === epNum) || {};

  // 이 에피소드의 contract 제약
  const kws   = (cEp.required_keywords || []).join('、');
  const vHint = cEp.villain_required === true
    ? '빌런(is_villain=true) 캐릭터 필수'
    : cEp.villain_required === false
      ? '빌런 없이 평범한 주인공(is_villain=false)'
      : '';
  const tone  = cEp.required_emotion_tone ? `감정 톤 「${cEp.required_emotion_tone}」` : '';
  const contractParts = [kws ? `키워드 최소 1개: [${kws}]` : '', vHint, tone].filter(Boolean).join(' / ');

  // 이 에피소드의 MZ 지시 (에피소드별 개별 적용)
  const isMzEp = includeMz && mzEpNum === epNum;
  const epAgeInstruction = isMzEp
    ? `【MZ世代 特別사연 — 절대 준수】
このエピソードの사연자는 반드시 10대~30대(10代〜30代)의 젊은 세대로 설정해라.
나이는 22歳, 28歳 등 구체적으로 명시할 것.
테마(「${topic}」)를 절대 바꾸지 말고, 10~30대의 현실적인 상황(취업 스트레스, 직장 번아웃, 연애/결혼 압박, タイムパフォーマンス, SNS 비교 등)으로 재해석해서 작성해라.`
    : `【연령 설정】
사연자는 50대 이상의 시니어층으로 설정해라.`;

  // 이 에피소드의 qaFeedback (에피소드별 개별 주입)
  const epFeedback = qaFeedback?.episodes?.find(e => e.id === epNum);
  const epFeedbackBlock = epFeedback
    ? `
【⚠️ QA 재작업 지시 — EP${epNum} 수정 사항 — 반드시 수정할 것】
이전 대본이 QA에서 실패했습니다.
감점 요약: ${(epFeedback.issues || []).join(' / ')}
수정 행동: ${(epFeedback.actionable_feedback || []).join(' / ')}
위 수정 행동을 완전히 적용 후 출력할 것. 같은 실수를 반복하면 안 된다.
`
    : '';

  const epPrompt = `${contextBlock}
---

あなたは「テンキ爺の電波局」専属シナリオライターです。
以下のテーマで、ラジオ投稿エピソードを1本執筆してください。
${epAgeInstruction}

テーマ: ${topic}
${contractParts ? `
【📋 計画書 制約 — QA 通過のため必ず守ること】
EP${epNum}: ${contractParts}
` : ''}${epFeedbackBlock}
【出力 JSON のみ返答】
{
  "id": ${epNum},
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
}`;

  console.log(`\n📝 EP${epNum} 대본 생성 중 (테마: ${topic})...`);

  const MAX_RETRY = 5;
  let retryCount = 0;
  let epData;
  let bestAttempt = null; // 분량 미달이라도 최선의 결과를 보관
  let lastLen = 0;

  while (retryCount < MAX_RETRY) {
    // 재시도 시 분량 피드백을 프롬프트 맨 앞에 주입 (첫 시도는 그대로)
    const retryPrefix = retryCount > 0
      ? `🚨🚨🚨 분량 재시도 경고 (${retryCount}/${MAX_RETRY - 1}회째) 🚨🚨🚨
이전 시도에서 script 필드가 ${lastLen}자였습니다. 800자 미만이므로 FAIL입니다.
지금 바로 수정하여 반드시 800자 이상 1,000자 이하로 다시 작성하세요.
분량을 채우는 구체적인 방법:
1. 사연자의 감정 변화를 처음→중간→결말 3단계로 나눠 각 단계를 2~3문장으로 묘사
2. 가족/직장동료/친구와의 실제 대화 한 마디 이상 직접 인용
3. 구체적인 날짜, 장소, 금액, 이름을 넣어 현실감 강화
4. 편지 형식: 인사말로 시작 → 사건 → 감정 변화 → 마무리 인사 구조 완성
현재 목표: 최소 ${Math.max(800, lastLen + 150)}자 이상\n\n`
      : '';

    const finalPrompt = retryPrefix + epPrompt;

    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: finalPrompt }],
      });
      const text = message.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('JSON 파싱 실패');
      const parsed = JSON.parse(jsonMatch[0]);
      // script 필드 오염 검사
      if (/ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(parsed.script || '')) {
        throw new Error('규칙 위반: script 필드에 금지된 의성어 포함됨');
      }
      // 분량 즉시 검증
      const scriptLen = (parsed.script || '').length;
      lastLen = scriptLen;

      // 최선의 결과를 항상 보관 (분량 미달이어도)
      if (!bestAttempt || scriptLen > (bestAttempt.script || '').length) {
        bestAttempt = { ...parsed, id: epNum };
      }

      if (scriptLen < 800) {
        throw new Error(`분량 부족: ${scriptLen}자 (최소 800자 필요)`);
      }
      console.log(`   ✅ EP${epNum} 생성 완료 (${scriptLen}자)`);
      epData = { ...parsed, id: epNum };
      break;
    } catch (err) {
      retryCount++;
      console.warn(`   ⚠️ EP${epNum} 재시도 ${retryCount}/${MAX_RETRY}: ${err.message}`);
      if (retryCount >= MAX_RETRY) {
        // 최대 재시도 초과 — process.exit 대신 최선의 결과로 계속 진행
        console.warn(`   ⚠️ EP${epNum} 최대 재시도(${MAX_RETRY}회) 초과 — 최선 결과(${lastLen}자)로 진행`);
        epData = bestAttempt;
      }
    }
  }

  episodes.push(epData);

  // 에피소드 간 딜레이 (rate limit 방어)
  if (epIdx < 2) {
    console.log('   ⏳ 1초 대기...');
    await new Promise(r => setTimeout(r, 1000));
  }
}

const data = { episodes };

fs.writeFileSync(P.scripts, JSON.stringify(data, null, 2), 'utf-8');
updateStage(P, 'scripted');

console.log('\n✅ 대본 생성 완료');
data.episodes.forEach(ep => {
  const villain = ep.character?.is_villain ? '🔴빌런' : '🟢평범';
  console.log(`   EP${ep.id} [${ep.theme}] "${ep.title}" — ${villain} ${ep.character?.personality_type}`);
  if (ep.character?.flaw_trigger) console.log(`      └ flaw: ${ep.character.flaw_trigger}`);
});
