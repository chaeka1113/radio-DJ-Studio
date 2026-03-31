---
name: script_writer
description: "[Trigger] 사용자가 새 라디오 방송 주제 3개를 입력하거나 /go-radio /auto-radio 파이프라인 STEP 1이 실행될 때. [Action] ref_script_rules.md를 주입해 일본 시니어 트렌드 반영 입체적 캐릭터의 일본어 사연 대본 3편을 생성하고, Claude API 자가 검증(3회 재시도) 후 01_scripts.json으로 저장한다. 실행 전 이전 작업물 전체 초기화."
---

あなたは深夜ラジオ「テンキ爺の電波局」専属シナリオライターです。

## 엔딩 중복 방지 강제 규칙

**QA 코너(`--qa` 플래그)가 존재하는 방송 구성일 경우:**
- 대본 본문(`01_scripts.json`) 및 DJ 스크립트(`02_dj_script.json`)의 맨 마지막에 별도의 '방송 엔딩(Show Closing)' 블록을 **절대 중복 생성하지 말 것**.
- QA 코너의 아웃트로(`08_qa_script.json`의 `outro`)가 방송 클로징 역할을 완전히 수행한다.
- `show_closing` 필드는 QA 모드에서도 `02_dj_script.json`에 포함하되, TTS 합본(STEP 7) 시 QA 아웃트로 **이후에** 붙이지 말 것 — `07_audio_director.md`의 청크 구성 참조.
- **위반 시 TTS에서 엔딩이 2회 렌더링되는 버그 발생** → 반드시 준수.

## 실행 전 필수: 전역 상태 초기화

스크립트 맨 앞에서 이전 작업물을 모두 삭제하고 백지 상태에서 시작한다:
- 삭제 대상 JSON: `01_scripts.json`, `02_dj_script.json`, `03_character_prompts.json`, `04_storyboard.json`, `05_image_results.json`, `06_video_results.json`, `08_qa_script.json`
- 삭제 대상 폴더: `images/`, `videos/`

## 실행 스크립트
`.radio_output/run_01_script.mjs` 작성 후 실행.

```javascript
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY 없음'); process.exit(1); }

const allArgs = process.argv.slice(2);
const includeMz = allArgs.includes('--mz');
const topics = allArgs.filter(a => a !== '--mz');
if (topics.length < 3) { console.error('❌ 주제 3개 필요'); process.exit(1); }

const mzEpNum = includeMz ? Math.floor(Math.random() * 3) + 1 : null;
if (includeMz) console.log(`🔥 MZ 모드 ON — EP${mzEpNum}를 10~30대 사연자로 설정`);

// ── 규칙 주입 ──────────────────────────────────────────────────────────────────
const referenceKnowledge = fs.readFileSync(path.join(__dirname, '../.claude/skills/ref_script_rules.md'), 'utf-8');

// ── 전역 상태 초기화 ───────────────────────────────────────────────────────────
console.log('🗑  이전 작업물 초기화 중...');
const JSON_FILES = ['01_scripts.json','02_dj_script.json','03_character_prompts.json','04_storyboard.json','05_image_results.json','06_video_results.json','08_qa_script.json'];
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

const prompt = `
${referenceKnowledge}

---

あなたは「テンキ爺の電波局」専属シナリオライターです。
以下の3テーマで、現在の日本のシニア層（50代以上）が共感できる最新トレンドを反映した
ラジオ投稿エピソードを各1本執筆してください。

テーマ1: ${topics[0]}
テーマ2: ${topics[1]}
テーマ3: ${topics[2]}

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
    const fullText = JSON.stringify(parsed);
    if (/[（）]/.test(fullText) || /ジジジ|ガガッ|ブーン|ギギギ|ザザッ/.test(fullText)) {
      throw new Error('규칙 위반: 금지된 괄호나 의성어가 포함됨');
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
data.episodes.forEach(ep =>
  console.log(`   EP${ep.id} [${ep.theme}] "${ep.title}" — ${ep.character?.personality_type}`)
);
```
