/**
 * run_00_planner.mjs — Planner Agent
 * 대본 작성 전 에피소드 완료 기준서(ref_episode_contract.json) 생성
 * Usage: node run_00_planner.mjs <topic1> <topic2> <topic3> [--mz] [--qna]
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs, initManifest } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

const API_KEY = requireEnv('ANTHROPIC_API_KEY');

const allArgs = process.argv.slice(2);
const includeMz = allArgs.includes('--mz');
const includeQna = allArgs.includes('--qna');
let topics = allArgs.filter(a => !a.startsWith('--'));

// 주제 미입력 시 00_trends.json 폴백
if (topics.length < 3) {
  if (fs.existsSync(P.trends)) {
    const trends = JSON.parse(fs.readFileSync(P.trends, 'utf-8'));
    if (Array.isArray(trends.topics) && trends.topics.length >= 3) {
      topics = trends.topics.slice(0, 3);
      console.log(`📡 [Planner] 트렌드 자동 수집 주제 사용:`);
      topics.forEach((t, i) => console.log(`   주제${i + 1}: ${t}`));
    }
  }
  if (topics.length < 3) { console.error('❌ 주제 3개 필요 (직접 입력하거나 run_00_trend_fetcher.mjs 를 먼저 실행하세요)'); process.exit(1); }
}

// 이전 피드백 파일 초기화 (새 파이프라인 시작 시 stale 피드백 제거)
if (fs.existsSync(P.qaFeedback)) {
  fs.unlinkSync(P.qaFeedback);
  console.log('🗑  이전 QA 피드백 초기화');
}
if (fs.existsSync(P.qaResult)) {
  fs.unlinkSync(P.qaResult);
}

// MZ 에피소드 번호 결정
const mzEpNum = includeMz ? Math.floor(Math.random() * 3) + 1 : null;
if (includeMz) console.log(`🔥 MZ 모드 ON — EP${mzEpNum}를 10~30대 사연자로 계획`);

// 빌런 확률 결정 (35% 확률, 발생 시 EP1~3 랜덤 배정)
const VILLAIN_PROB = 0.35;
const villainOccurs = Math.random() < VILLAIN_PROB;
const villainEpNum = villainOccurs ? Math.floor(Math.random() * 3) + 1 : null;
if (villainOccurs) console.log(`🔴 빌런 발생 — EP${villainEpNum}에 사연자 본인이 빌런(가해자) 배정`);
else console.log(`🟢 이번 방송 빌런 없음 (전원 평범 사연자)`);

// MZ와 빌런 EP 충돌 방지: 같은 EP라면 빌런 EP를 재추첨
let finalVillainEpNum = villainEpNum;
if (villainOccurs && mzEpNum !== null && villainEpNum === mzEpNum) {
  const others = [1, 2, 3].filter(n => n !== mzEpNum);
  finalVillainEpNum = others[Math.floor(Math.random() * others.length)];
  console.log(`⚠️  MZ(EP${mzEpNum})·빌런 충돌 → 빌런 EP${finalVillainEpNum}으로 재배정`);
}

// 에피소드별 villain_required 맵 (LLM에게 주입할 사전 결정값)
const villainMap = { 1: false, 2: false, 3: false };
if (villainOccurs) villainMap[finalVillainEpNum] = true;

// 빌런 아키타입 랜덤 선택 (villain_required=true 에피소드에만 적용)
const VILLAIN_ARCHETYPES = [
  {
    id: '自業自得型',
    desc: '본인이 초래한 상황인데 억울해하며 투고하는 유형. 사연을 읽다 보면 결국 자기가 씨를 뿌렸음이 드러난다.',
    example: '아들이 연락을 끊었다고 억울해하지만, 사연 속 과거 행동을 보면 본인이 평생 아들을 무시·억압해온 게 드러남',
  },
  {
    id: '善意の迷惑型',
    desc: '좋은 의도라고 믿지만 주변에 민폐를 끼치는 유형. 왜 가족/동료가 싫어하는지 전혀 모른다.',
    example: '가족을 걱정해서 한 일이라고 쓰지만, 읽다 보면 과잉간섭·통제 행동이 드러나 주변이 지쳐 떠난 상황',
  },
  {
    id: 'お門違い型',
    desc: '화살표 방향이 완전히 반대인 유형. 자신이 피해자라 확신하지만 객관적으로 보면 본인이 가해자.',
    example: '직장 동료가 왕따시킨다고 쓰지만, 사연 속 디테일을 보면 본인의 言動이 직장 분위기를 망쳐왔음이 드러남',
  },
];
const villainArchetype = villainOccurs
  ? VILLAIN_ARCHETYPES[Math.floor(Math.random() * VILLAIN_ARCHETYPES.length)]
  : null;
if (villainArchetype) console.log(`   아키타입: ${villainArchetype.id} — ${villainArchetype.desc.slice(0, 30)}...`);

const client = new Anthropic({ apiKey: API_KEY });

const prompt = `
당신은 일본 시니어 라디오 방송 "テンキ爺の電波局"의 수석 기획자입니다.
아래 3개의 에피소드 테마를 바탕으로, 대본 작가가 반드시 지켜야 할 "에피소드 완료 기준서(Episode Contract)"를 JSON으로 작성해라.

테마1: ${topics[0]}
테마2: ${topics[1]}
테마3: ${topics[2]}
MZ 모드: ${includeMz ? `ON — EP${mzEpNum}의 사연자를 10~30대로 설정` : 'OFF (전원 50代 이상 시니어)'}
Q&A 모드: ${includeQna ? 'ON' : 'OFF'}
빌런 배정 (사전 결정 — 변경 금지):
  EP1 villain_required = ${villainMap[1]}
  EP2 villain_required = ${villainMap[2]}
  EP3 villain_required = ${villainMap[3]}

【계약서 작성 규칙】
1. required_keywords: 각 테마에서 대본에 반드시 등장해야 할 핵심 일본어 키워드 3~5개
2. character_profile.age_range: MZ 모드 해당 에피소드는 "10代〜30代", 나머지는 "50代以上"
3. required_emotion_tone: 該 테마에 어울리는 감정 톤 (苦笑い|哀愁|懐かしさ|ほっこり|驚き 중 1개)
4. forbidden_drift: 이 테마에서 절대 빠지면 안 되는 주제 이탈 패턴 예시 1~2개
5. villain_required: 위 "빌런 배정" 값을 그대로 사용할 것. LLM이 임의로 변경하지 말 것.
   villain_required=true인 에피소드는 아래 아키타입과 irony_reveal을 반드시 설계할 것:
   ${villainArchetype ? `
   ⚠️ 이번 빌런 아키타입: 【${villainArchetype.id}】
   정의: ${villainArchetype.desc}
   예시 참고: ${villainArchetype.example}

   핵심 원칙:
   - 사연자는 본인이 억울한 피해자라고 믿으며 투고한다 (본인 자각 없음)
   - 하지만 사연 속 디테일(말투·행동·과거)을 읽으면 청취자는 사연자가 문제임을 알아챈다
   - 사연자가 명백한 나쁜 짓을 하는 게 아니라, 자각 없이 주변을 힘들게 하는 구조
   - narrative_arc는 이 아키타입에 맞게 설계할 것` : ''}
6. narrative_arc: 사연의 起承転結 4단계 스케치 (각 50字 이내 일본어)
   - setup: 주인공과 배경 상황
   - incident: 이야기의 발단·사건
   - turn: 감정의 전환점 또는 갈등 고조
   - resolution: 결말 또는 투고 동기
   villain_required=true인 경우 추가 필드:
   - irony_reveal: 사연자가 억울하다 쓰지만, 어떤 구체적 사실·행동·대사에서 청취자가 "아, 이 사람이 문제구나"를 깨닫게 되는 반전 장면 (60字 이내 일본어)
7. tenki_jii_hooks: テンキ爺가 끼어들 장면 힌트 2개 (독설/공감/설 치는 타이밍)
   - 각 항목은 「장면 설명 → テンキ爺 반응 유형」형식
   - 예: "息子に「自業自得」と言われる → 独説타이밍"

【출력 JSON만 반환, 설명 없음】
{
  "contract_version": "1.1",
  "generated_at": "${new Date().toISOString()}",
  "topics": ${JSON.stringify(topics.slice(0, 3))},
  "mz_mode": ${includeMz},
  "mz_episode_id": ${mzEpNum ?? 'null'},
  "qna_mode": ${includeQna},
  "episodes": [
    {
      "id": 1,
      "theme": "테마 이름 (일본어)",
      "required_keywords": ["키워드1", "키워드2", "키워드3"],
      "character_profile": {
        "age_range": "50代以上",
        "gender_hint": "any",
        "personality_hint": "캐릭터 성격 한 줄 힌트 (일본어)"
      },
      "required_emotion_tone": "苦笑い",
      "forbidden_drift": ["이탈 패턴 예시1"],
      "villain_required": false,
      "villain_archetype": null,
      "script_length_range": "700〜1000文字",
      "narrative_arc": {
        "setup": "주인공과 상황 설정 (50字 이내 일본어)",
        "incident": "발단이 되는 사건 (50字 이내 일본어)",
        "turn": "감정 전환점 또는 갈등 (50字 이내 일본어)",
        "resolution": "결말 또는 투고 동기 (50字 이내 일본어)",
        "irony_reveal": null
      },
      "tenki_jii_hooks": [
        "장면 → テンキ爺 반응 유형 (예: 독설/공감/침묵후 설치기)",
        "장면 → テンキ爺 반응 유형"
      ]
    },
    { "id": 2 },
    { "id": 3 }
  ]
}`;

console.log('📋 [Planner] 에피소드 계약서 생성 중...');

let retryCount = 0;
let contract;
while (retryCount < 3) {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    contract = JSON.parse(jsonMatch[0]);
    if (!contract.episodes || contract.episodes.length < 3) throw new Error('에피소드 3개 필요');
    // villain_required·villain_archetype 강제 적용 (LLM 임의 변경 무시)
    contract.villain_occurs = villainOccurs;
    contract.villain_episode_id = finalVillainEpNum ?? null;
    contract.episodes.forEach(ep => {
      ep.villain_required = villainMap[ep.id] ?? false;
      if (ep.villain_required && villainArchetype) {
        ep.villain_archetype = villainArchetype.id;
        ep.villain_archetype_desc = villainArchetype.desc;
        // irony_reveal은 LLM이 설계한 값 유지 (없으면 기본값)
        if (!ep.narrative_arc) ep.narrative_arc = {};
        if (!ep.narrative_arc.irony_reveal) {
          ep.narrative_arc.irony_reveal = `${villainArchetype.example} (플래너가 구체화할 것)`;
        }
      } else {
        ep.villain_archetype = null;
        if (ep.narrative_arc) ep.narrative_arc.irony_reveal = null;
      }
    });
    break;
  } catch (err) {
    retryCount++;
    console.warn(`⚠️ 재시도 ${retryCount}/3: ${err.message}`);
    if (retryCount >= 3) { console.error('❌ Planner 최대 재시도 초과'); process.exit(1); }
  }
}

fs.writeFileSync(P.epContract, JSON.stringify(contract, null, 2), 'utf-8');
initManifest(P, { epId, topics, qaMode: includeQna });

console.log('✅ [Planner] 계약서 생성 완료 → ref_episode_contract.json');
contract.episodes.forEach(ep => {
  const vTag = ep.villain_required ? ' 🔴빌런' : '';
  const mzTag = (includeMz && ep.id === mzEpNum) ? ' 🔥MZ' : '';
  console.log(`   EP${ep.id} [${ep.theme}]${vTag}${mzTag} 키워드: ${(ep.required_keywords || []).join(', ')}`);
});
