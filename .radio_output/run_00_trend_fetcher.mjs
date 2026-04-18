/**
 * run_00_trend_fetcher.mjs — 일본 50대+ 트렌드 자동 수집기
 *
 * Yahoo Japan RSS + NHK RSS + 日経 RSS 에서 실시간 뉴스를 수집하고
 * Claude AI로 시니어 라디오 방송에 적합한 주제 3개를 선별한다.
 *
 * Usage: node run_00_trend_fetcher.mjs
 * Output: .radio_output/00_trends.json
 * Stdout (last line): TOPICS:テマ1|テマ2|テマ3   ← server.mjs가 파싱
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import { loadEnv, requireEnv } from './lib/env.mjs';
import { generateEpId, makePaths, ensureDirs } from './lib/paths.mjs';

loadEnv();
const epId = process.env.EP_ID ?? generateEpId();
const P    = makePaths(epId);
ensureDirs(P);

const API_KEY = requireEnv('ANTHROPIC_API_KEY');

// ── RSS 피드 목록 ─────────────────────────────────────────────────────────
const RSS_FEEDS = [
  { name: 'Yahoo!ニュース 健康',   url: 'https://news.yahoo.co.jp/rss/topics/health.xml' },
  { name: 'Yahoo!ニュース 暮らし', url: 'https://news.yahoo.co.jp/rss/topics/life.xml' },
  { name: 'Yahoo!ニュース 国内',   url: 'https://news.yahoo.co.jp/rss/topics/domestic.xml' },
  { name: 'NHK 社会',             url: 'https://www3.nhk.or.jp/rss/news/cat1.xml' },
  { name: 'NHK 科学・医療',        url: 'https://www3.nhk.or.jp/rss/news/cat2.xml' },
  { name: '日経新聞',              url: 'https://www.nikkei.com/rss/cgi-bin/svrss.cgi?path=main1' },
];

// ── XML パース: <item> ブロック方式 ───────────────────────────────────────
// 3つの形態を安全に処理:
//   形態1 (CDATA): <title><![CDATA[タイトル]]></title>
//   形態2 (一般):  <title>タイトル</title>
//   形態3 (混合):  <title>  <![CDATA[ タイトル ]]>  </title>
function parseRssTitles(xml, maxItems = 15) {
  const titles = [];
  // <item> ブロックだけ先に切り出して channel <title> と分離
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g) || [];
  for (const item of itemBlocks.slice(0, maxItems)) {
    const match = item.match(
      /<title>\s*(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?\s*<\/title>/
    );
    if (match && match[1].trim()) {
      const title = match[1]
        .trim()
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      if (title.length > 5 && title.length < 120) titles.push(title);
    }
  }
  return titles;
}

// ── RSS フェッチ ──────────────────────────────────────────────────────────
async function fetchRssTitles(feed) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RadioDJBot/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const titles = parseRssTitles(xml);
    console.log(`   ✓ ${feed.name}: ${titles.length}건`);
    return titles;
  } catch (err) {
    console.warn(`   ✗ ${feed.name}: ${err.message}`);
    return [];
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── メイン ────────────────────────────────────────────────────────────────
console.log('🌐 [Trend Fetcher] RSS 수집 시작...');

const allTitles = [];
for (let i = 0; i < RSS_FEEDS.length; i++) {
  if (i > 0) await sleep(500); // 피드 간 500ms 딜레이 (예의 있는 크롤링)
  const titles = await fetchRssTitles(RSS_FEEDS[i]);
  allTitles.push(...titles);
}

// 중복 제거
const uniqueTitles = [...new Set(allTitles)];
console.log(`📰 총 ${uniqueTitles.length}건 수집 완료\n`);

if (uniqueTitles.length < 5) {
  console.error('❌ 수집된 기사가 너무 적습니다. 네트워크 연결을 확인하세요.');
  process.exit(1);
}

// ── Claude로 시니어 주제 3개 선별 ─────────────────────────────────────────
const client = new Anthropic({ apiKey: API_KEY });

const selectionPrompt = `당신은 일본 시니어 라디오 "テンキ爺の電波局"의 콘텐츠 큐레이터입니다.
아래 일본어 뉴스 헤드라인 ${uniqueTitles.length}건에서
라디오 사연 테마로 쓸 수 있는 간결한 일본어 키워드 5개를 선별해 주세요.
시니어(50대+) 적합 주제 4개 + MZ세대(10~30대) 적합 주제 1개를 포함할 것.

【선별 기준 — 반드시 준수】
① 시니어 주제: 50대 이상 일상과 직결 (건강, 가족, 노후, 직장, 관계, 취미)
② MZ 주제: 10~30대 공감 (연애, SNS, 취업, 학교, 청년문화, 디지털)
③ 5개 주제는 모두 서로 다른 카테고리 (동일 카테고리 중복 금지)
④ 사연 형식으로 자연스럽게 쓸 수 있는 주제
⑤ 뉴스 헤드라인을 그대로 쓰지 말고 라디오 테마로 추상화할 것
   (예: "高齢者の交通事故増加" → "免許返納")
⑥ 정치·해외 분쟁·연예 스캔들·기업 실적 제외

【헤드라인 목록】
${uniqueTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

【출력 JSON만 반환, 설명 일절 없음】
{
  "topics": ["シニアテーマ1（10文字以内）", "シニアテーマ2", "シニアテーマ3", "シニアテーマ4", "MZテーマ1"],
  "rationale": ["이유1", "이유2", "이유3", "이유4", "이유5(MZ)"],
  "source_headlines": ["원본1", "원본2", "원본3", "원본4", "원본5"]
}`;

console.log('🤖 [Trend Fetcher] Claude로 주제 선별 중...');

let result;
let retries = 0;
while (retries < 3) {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: selectionPrompt }],
    });
    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.topics) || parsed.topics.length < 5) throw new Error('주제 5개 필요');
    result = parsed;
    break;
  } catch (err) {
    retries++;
    console.warn(`⚠️ 재시도 ${retries}/3: ${err.message}`);
    if (retries >= 3) { console.error('❌ 주제 선별 실패'); process.exit(1); }
  }
}

// ── 저장 ──────────────────────────────────────────────────────────────────
const output = {
  fetched_at: new Date().toISOString(),
  source_feeds: RSS_FEEDS.map(f => f.name),
  total_headlines: uniqueTitles.length,
  topics: result.topics,
  rationale: result.rationale ?? [],
  source_headlines: result.source_headlines ?? [],
};

fs.writeFileSync(
  P.trends,
  JSON.stringify(output, null, 2),
  'utf-8'
);

console.log('✅ [Trend Fetcher] 주제 선별 완료 → 00_trends.json');
result.topics.forEach((t, i) => {
  const label = i === 4 ? 'MZ주제' : `주제${i + 1}`;
  console.log(`   ${label}: ${t}`);
  if (output.rationale[i]) console.log(`        └ ${output.rationale[i]}`);
});
console.log('');

// server.mjs가 stdout에서 이 줄을 파싱해 TREND_TOPICS SSE로 클라이언트에 전달함
// 반드시 마지막 줄에 단독 출력할 것
process.stdout.write(`TOPICS:${result.topics.join('|')}\n`);
