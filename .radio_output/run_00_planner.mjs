/**
 * run_00_planner.mjs — Planner Agent
 * 대본 작성 전 에피소드 완료 기준서(ref_episode_contract.json) 생성
 * Usage: node run_00_planner.mjs <topic1> <topic2> <topic3> [--mz] [--qna]
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 로드 (루트 기준)
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const k = t.slice(0, idx).trim(), v = t.slice(idx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }

const allArgs = process.argv.slice(2);
const includeMz = allArgs.includes('--mz');
const includeQna = allArgs.includes('--qna');
const topics = allArgs.filter(a => !a.startsWith('--'));
if (topics.length < 3) { console.error('❌ 주제 3개 필요'); process.exit(1); }

// 이전 피드백 파일 초기화 (새 파이프라인 시작 시 stale 피드백 제거)
const feedbackPath = path.join(__dirname, '01_qa_feedback.json');
if (fs.existsSync(feedbackPath)) {
  fs.unlinkSync(feedbackPath);
  console.log('🗑  이전 QA 피드백 초기화');
}
const qaResultPath = path.join(__dirname, '01_qa_result.json');
if (fs.existsSync(qaResultPath)) {
  fs.unlinkSync(qaResultPath);
}

// MZ 에피소드 번호 결정
const mzEpNum = includeMz ? Math.floor(Math.random() * 3) + 1 : null;
if (includeMz) console.log(`🔥 MZ 모드 ON — EP${mzEpNum}를 10~30대 사연자로 계획`);

const client = new Anthropic({ apiKey: API_KEY });

const prompt = `
당신은 일본 시니어 라디오 방송 "テンキ爺の電波局"의 수석 기획자입니다.
아래 3개의 에피소드 테마를 바탕으로, 대본 작가가 반드시 지켜야 할 "에피소드 완료 기준서(Episode Contract)"를 JSON으로 작성해라.

테마1: ${topics[0]}
테마2: ${topics[1]}
테마3: ${topics[2]}
MZ 모드: ${includeMz ? `ON — EP${mzEpNum}의 사연자를 10~30대로 설정` : 'OFF (전원 50代 이상 시니어)'}
Q&A 모드: ${includeQna ? 'ON' : 'OFF'}

【계약서 작성 규칙】
1. required_keywords: 각 테마에서 대본에 반드시 등장해야 할 핵심 일본어 키워드 3~5개
2. character_profile.age_range: MZ 모드 해당 에피소드는 "10代〜30代", 나머지는 "50代以上"
3. required_emotion_tone: 該 테마에 어울리는 감정 톤 (苦笑い|哀愁|懐かしさ|ほっこり|驚き 중 1개)
4. forbidden_drift: 이 테마에서 절대 빠지면 안 되는 주제 이탈 패턴 예시 1~2개
5. villain_required: 빌런 캐릭터가 반드시 필요한지 여부 (boolean)

【출력 JSON만 반환, 설명 없음】
{
  "contract_version": "1.0",
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
        "personality_hint": "캐릭터 성격 한 줄 힌트"
      },
      "required_emotion_tone": "苦笑い",
      "forbidden_drift": ["이탈 패턴 예시1"],
      "villain_required": false,
      "script_length_range": "800〜1000文字"
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
    break;
  } catch (err) {
    retryCount++;
    console.warn(`⚠️ 재시도 ${retryCount}/3: ${err.message}`);
    if (retryCount >= 3) { console.error('❌ Planner 최대 재시도 초과'); process.exit(1); }
  }
}

fs.writeFileSync(path.join(__dirname, 'ref_episode_contract.json'), JSON.stringify(contract, null, 2), 'utf-8');

console.log('✅ [Planner] 계약서 생성 완료 → ref_episode_contract.json');
contract.episodes.forEach(ep => {
  console.log(`   EP${ep.id} [${ep.theme}] 키워드: ${(ep.required_keywords || []).join(', ')}`);
});
