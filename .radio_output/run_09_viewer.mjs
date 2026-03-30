/**
 * テンキ爺ラジオ — Web Viewer Dashboard
 * 생성된 이미지/영상/대본을 브라우저에서 한눈에 확인
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 데이터 로드
const storyboard = JSON.parse(fs.readFileSync(path.join(__dirname, '04_storyboard.json'), 'utf-8'));
// flat 배열(신규) 또는 episodes[].scenes(구형) 모두 지원
const scenes = storyboard.scenes
  ?? storyboard.episodes?.flatMap(ep => (ep.scenes || []).map(s => ({ ...s, episode_id: ep.episode_id ?? ep.id })))
  ?? [];

const scriptText = fs.existsSync(path.join(__dirname, 'final_script_for_tts.txt'))
  ? fs.readFileSync(path.join(__dirname, 'final_script_for_tts.txt'), 'utf-8')
  : '(TTS 합본이 아직 생성되지 않았습니다)';

// ── 씬별 미디어 파일 매핑
const mediaItems = scenes.map(scene => {
  const imgPath = path.join(__dirname, 'images', `${scene.scene_id}.png`);
  const vidPath = path.join(__dirname, 'videos', `${scene.scene_id}.mp4`);
  return {
    scene_id: scene.scene_id,
    type: scene.type,
    episode_id: scene.episode_id || null,
    speaker: scene.speaker,
    dialogue: scene.japanese_dialogue?.slice(0, 60) || '',
    has_image: fs.existsSync(imgPath),
    has_video: fs.existsSync(vidPath),
  };
});

const totalScenes = scenes.length;
const imageCount = mediaItems.filter(m => m.has_image).length;
const videoCount = mediaItems.filter(m => m.has_video).length;

// ── HTML 생성
function buildHTML() {
  const mediaCards = mediaItems.map(item => {
    const imgSrc = item.has_image ? `images/${item.scene_id}.png` : null;
    const vidSrc = item.has_video ? `videos/${item.scene_id}.mp4` : null;
    const isDJ = item.type === 'DJ_SHOT';
    const borderColor = isDJ ? 'border-amber-500' : 'border-blue-600';
    const badge = isDJ
      ? '<span class="text-xs bg-amber-600 text-white px-1.5 py-0.5 rounded">DJ</span>'
      : `<span class="text-xs bg-blue-700 text-white px-1.5 py-0.5 rounded">${item.type?.replace('_', ' ') || 'SCENE'}</span>`;

    let mediaEl = '';
    if (vidSrc) {
      mediaEl = `<video src="${vidSrc}" autoplay loop muted playsinline class="w-full rounded aspect-video bg-gray-800"></video>`;
    } else if (imgSrc) {
      mediaEl = `<img src="${imgSrc}" class="w-full rounded aspect-video object-cover bg-gray-800 cursor-pointer" loading="lazy" onclick="openModal('${imgSrc}')" />`;
    } else {
      mediaEl = `<div class="w-full aspect-video bg-gray-800 rounded flex items-center justify-center text-gray-500 text-sm">미생성</div>`;
    }

    return `
    <div class="bg-gray-800 border ${borderColor} border-opacity-40 rounded-lg p-3 flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-gray-400 font-mono">${item.scene_id}</span>
        ${badge}
      </div>
      ${mediaEl}
      <p class="text-xs text-gray-400 leading-relaxed line-clamp-2">${item.dialogue || ''}</p>
      <p class="text-xs text-gray-600">${item.speaker || ''}</p>
    </div>`;
  }).join('\n');

  const scriptEscaped = scriptText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/【テンキ爺】/g, '<span class="text-amber-400 font-bold">【テンキ爺】</span>')
    .replace(/【ナレーター[^】]*】/g, m => `<span class="text-blue-400 font-bold">${m}</span>`)
    .replace(/【즉문즉답 코너】/g, '<span class="text-green-400 font-bold">【즉문즉답 코너】</span>')
    .replace(/━+/g, '<hr class="border-gray-600 my-1">')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="ja" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>テンキ爺ラジオ — Viewer Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #1f2937; }
  ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 3px; }
  .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
</head>
<body class="bg-gray-900 text-gray-100 font-sans h-screen flex flex-col">

<!-- 헤더 -->
<header class="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between shrink-0">
  <div class="flex items-center gap-3">
    <span class="text-2xl">📻</span>
    <div>
      <h1 class="text-lg font-bold text-amber-400">テンキ爺ラジオ</h1>
      <p class="text-xs text-gray-400">Viewer Dashboard</p>
    </div>
  </div>
  <div class="flex gap-6 text-sm text-gray-400">
    <span>씬 <strong class="text-white">${totalScenes}</strong></span>
    <span>이미지 <strong class="text-green-400">${imageCount}</strong></span>
    <span>영상 <strong class="text-blue-400">${videoCount}</strong></span>
  </div>
</header>

<!-- 본문: 2컬럼 레이아웃 -->
<div class="flex flex-1 overflow-hidden">

  <!-- 좌측: 대본 패널 -->
  <aside class="w-96 shrink-0 bg-gray-850 border-r border-gray-700 flex flex-col">
    <div class="px-4 py-2 border-b border-gray-700 bg-gray-800">
      <h2 class="text-sm font-semibold text-gray-300">📄 TTS 합본 대본</h2>
    </div>
    <div class="flex-1 overflow-y-auto px-4 py-3">
      <pre class="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-mono" style="font-size:11px">${scriptEscaped}</pre>
    </div>
  </aside>

  <!-- 우측: 씬 갤러리 -->
  <main class="flex-1 overflow-y-auto p-4">
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      ${mediaCards}
    </div>
  </main>

</div>

<!-- 이미지 모달 -->
<div id="modal" class="hidden fixed inset-0 bg-black bg-opacity-80 z-50 flex items-center justify-center p-4" onclick="closeModal()">
  <img id="modal-img" src="" class="max-w-full max-h-full rounded-lg shadow-2xl" />
</div>

<script>
function openModal(src) {
  document.getElementById('modal-img').src = src;
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
</script>

</body>
</html>`;
}

const html = buildHTML();
const viewerPath = path.join(__dirname, 'viewer.html');
fs.writeFileSync(viewerPath, html, 'utf-8');
console.log(`✅ viewer.html 생성 완료`);
console.log(`   씬: ${totalScenes}개 | 이미지: ${imageCount}개 | 영상: ${videoCount}개`);
console.log(`\n📡 뷰어를 보려면 터미널에서 아래 명령어를 실행하세요:\n`);
console.log(`   npx serve .radio_output\n`);
console.log(`   그런 다음 브라우저에서 http://localhost:3000 열기`);
console.log(`   (포트가 다를 경우 터미널 출력 확인)\n`);
