/* Shared sketch primitives */

const Box = ({ children, className = '', style, ...rest }) => (
  <div className={`sk-box ${className}`} style={style} {...rest}>{children}</div>
);

const Lines = ({ n = 3 }) => (
  <div className="sk-lines">
    {Array.from({ length: n }).map((_, i) => <span key={i} />)}
  </div>
);

const Img = ({ label, ratio = '16/9', tone, style }) => (
  <div className="sk-img" style={{ aspectRatio: ratio, background: tone, ...style }}>
    {label && <div className="sk-img-label">{label}</div>}
  </div>
);

const Btn = ({ children, variant = '', tiny }) => (
  <button className={`sk-btn ${variant} ${tiny ? 'tiny' : ''}`}>{children}</button>
);

const Tag = ({ children, variant = '' }) => (
  <span className={`sk-tag ${variant}`}>{children}</span>
);

const Dot = ({ status = 'idle' }) => <span className={`sk-dot ${status}`} />;

const Anno = ({ children }) => <span className="sk-anno">{children}</span>;

const Sticky = ({ children, style }) => (
  <div className="sticky" style={style}>{children}</div>
);

// Tiny SVG curl arrow for hand-drawn pointers
const CurlArrow = ({ d, stroke = '#d94a1a', w = 80, h = 40, style }) => (
  <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', ...style }}>
    <path d={d} stroke={stroke} strokeWidth="2" fill="none" strokeLinecap="round" />
  </svg>
);

// Pipeline step list shared
const PIPELINE_STEPS = [
  { id: '00t', ko: '트렌드',    ja: 'トレンド',     icon: '🌐' },
  { id: '00p', ko: '플래너',    ja: 'プランナー',   icon: '📋' },
  { id: '01',  ko: '대본',      ja: '台本',         icon: '📝' },
  { id: '01q', ko: 'QA',        ja: 'QA',           icon: '🔍' },
  { id: '02',  ko: 'DJ멘트',    ja: 'DJコメント',   icon: '🤖' },
  { id: '03',  ko: '캐스팅',    ja: 'キャスト',     icon: '🎭' },
  { id: '04',  ko: '스토리보드',ja: 'ストーリーボード', icon: '🎬' },
  { id: '04q', ko: '시각QA',    ja: '視覚QA',       icon: '👁' },
  { id: '05',  ko: '이미지',    ja: '画像',         icon: '🖼' },
  { id: '07',  ko: 'TTS',       ja: 'TTS',          icon: '🎧' },
  { id: '06',  ko: 'CapCut',    ja: 'CapCut',       icon: '🎞' },
  { id: '08',  ko: '자막',      ja: '字幕',         icon: '💬' },
  { id: '99',  ko: '오답노트',  ja: '振り返り',     icon: '🧠' },
];

Object.assign(window, { Box, Lines, Img, Btn, Tag, Dot, Anno, Sticky, CurlArrow, PIPELINE_STEPS });
