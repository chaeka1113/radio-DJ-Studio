/* Variant 3 — SCENE STRIP: scene-as-row, all assets per scene aligned */

function VariantSceneStrip() {
  const scenes = [
    { id: 'EP1-S01', type: 'DJ_SHOT',         spk: 'TENKI_JII', ja: '今日の最初のお話は…茨城県の田中さんから。',                          dur: '6.2s', img: 'ok' },
    { id: 'EP1-S02', type: 'ESTABLISHING',    spk: '—',          ja: '雨が降る秋の朝、古い木造の家。',                                       dur: '4.8s', img: 'ok' },
    { id: 'EP1-S03', type: 'CHARACTER_SCENE', spk: '田中信夫',   ja: '昔は薬なんか飲まなくても元気だったのに…',                                dur: '5.1s', img: 'ok' },
    { id: 'EP1-S04', type: 'FLASHBACK',       spk: '田中(young)',ja: '若い頃、毎朝畑に出ていた。',                                          dur: '4.0s', img: 'run' },
    { id: 'EP1-S05', type: 'CLOSE_UP',        spk: '田中信夫',   ja: '妻が一年前に逝ってから、台所が静かでね。',                              dur: '5.5s', img: 'idle' },
    { id: 'EP1-S06', type: 'DJ_SHOT',         spk: 'TENKI_JII', ja: 'なるほど…昭和の朝が懐かしいね。次の便りへ。',                            dur: '5.0s', img: 'idle' },
  ];

  const typeColor = (t) => ({
    DJ_SHOT: 'var(--accent)',
    FLASHBACK: '#c98a1a',
    CLOSE_UP: '#7a4ec9',
    CHARACTER_SCENE: '#2d7a3e',
    ESTABLISHING: '#3a6ea5',
  })[t] || 'var(--ink-soft)';

  return (
    <div className="canvas">
      <span className="canvas-label">안 ③  씬 스트립 — 한 줄에 모든 자산 정렬</span>

      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <div className="sk-h" style={{ fontSize: '1.5em' }}>EP_2026-04-18-1430 / EP1: 健康</div>
          <div className="sk-label">12 씬 · 총 73초 · 8/12 이미지 완료</div>
        </div>
        <div className="row gap-2">
          <Btn tiny>EP1 健康</Btn>
          <Btn tiny variant="ghost">EP2 財テク</Btn>
          <Btn tiny variant="ghost">EP3 ロマンス</Btn>
          <span style={{ width: 16 }} />
          <Btn tiny variant="primary">▶ 미리보기</Btn>
        </div>
      </div>

      {/* Compact pipeline status */}
      <Box className="p-2 thin" style={{ marginBottom: 12 }}>
        <div className="row gap-3 items-center" style={{ fontSize: 12 }}>
          <span className="sk-label">단계</span>
          {['📝 대본', '🤖 DJ', '🎭 캐스팅', '🎬 보드', '🖼 이미지', '🎧 TTS', '🎞 CapCut'].map((s, i) => (
            <span key={i} className="row gap-1 items-center">
              <Dot status={i < 4 ? 'ok' : i === 4 ? 'run' : 'idle'} /> {s}
            </span>
          ))}
          <div className="flex-1" />
          <span className="sk-mono">07:24 경과</span>
        </div>
      </Box>

      {/* Column headers */}
      <div className="row gap-2" style={{ paddingLeft: 8, marginBottom: 4 }}>
        <span className="sk-label" style={{ width: 70 }}>씬</span>
        <span className="sk-label" style={{ width: 180 }}>이미지</span>
        <span className="sk-label" style={{ width: 220 }}>대본 / 일본어</span>
        <span className="sk-label" style={{ width: 200 }}>DJ 멘트</span>
        <span className="sk-label" style={{ flex: 1 }}>오디오 / 자막</span>
        <span className="sk-label" style={{ width: 100, textAlign: 'right' }}>액션</span>
      </div>

      {/* Scene rows */}
      <div className="col gap-2">
        {scenes.map((sc) => (
          <Box key={sc.id} className="p-2 thin" style={{
            borderLeft: `4px solid ${typeColor(sc.type)}`,
          }}>
            <div className="row gap-2 items-center">
              {/* col: meta */}
              <div className="col" style={{ width: 70 }}>
                <span className="sk-mono" style={{ fontWeight: 700, fontSize: 11 }}>{sc.id}</span>
                <span className="sk-mono" style={{ fontSize: 9, color: typeColor(sc.type) }}>{sc.type}</span>
                <span className="sk-mono" style={{ fontSize: 9, color: 'var(--ink-soft)' }}>{sc.dur}</span>
              </div>

              {/* col: image */}
              <div style={{ width: 180 }}>
                {sc.img === 'ok' ? (
                  <Img label={sc.id} ratio="16/9" />
                ) : sc.img === 'run' ? (
                  <Box className="thin center" style={{ aspectRatio: '16/9', background: 'var(--accent-soft)' }}>
                    <span className="sk-mono">⏳ 생성 중</span>
                  </Box>
                ) : (
                  <Box className="thin dashed center" style={{ aspectRatio: '16/9' }}>
                    <span className="sk-mono" style={{ color: 'var(--ink-faint)' }}>대기</span>
                  </Box>
                )}
              </div>

              {/* col: script */}
              <div className="col gap-1" style={{ width: 220 }}>
                <span className="sk-mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{sc.spk}</span>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>「{sc.ja}」</div>
                <span className="sk-label">📝 01 대본</span>
              </div>

              {/* col: DJ reaction */}
              <div className="col" style={{ width: 200 }}>
                {sc.type === 'DJ_SHOT' ? (
                  <Lines n={4} />
                ) : (
                  <span className="sk-mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>—</span>
                )}
                <span className="sk-label" style={{ marginTop: 4 }}>🤖 02 DJ멘트</span>
              </div>

              {/* col: audio waveform */}
              <div className="col flex-1">
                <div className="row items-center gap-1" style={{ height: 32 }}>
                  {Array.from({ length: 40 }).map((_, i) => (
                    <span key={i} style={{
                      display: 'block',
                      width: 3,
                      background: sc.img === 'idle' ? 'var(--ink-faint)' : 'var(--ink)',
                      opacity: sc.img === 'idle' ? 0.3 : 0.85,
                      height: `${10 + Math.abs(Math.sin(i * 0.6 + sc.dur.length)) * 22}px`,
                      borderRadius: 1,
                    }} />
                  ))}
                </div>
                <span className="sk-mono" style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 2 }}>
                  💬 {sc.id.toLowerCase()}_subs.srt · 🎧 ElevenLabs
                </span>
              </div>

              {/* col: actions */}
              <div className="col gap-1" style={{ width: 100, alignItems: 'flex-end' }}>
                <Btn tiny>✏ 수정</Btn>
                <Btn tiny>🔄 재생성</Btn>
                <Btn tiny variant="ghost">▶ 재생</Btn>
              </div>
            </div>
          </Box>
        ))}
      </div>

      {/* footer: timeline mini */}
      <Box className="p-3 dark" style={{ marginTop: 14 }}>
        <div className="row between" style={{ marginBottom: 6 }}>
          <span className="sk-label" style={{ color: 'var(--accent-soft)' }}>전체 영상 타임라인 미리보기</span>
          <span className="sk-mono">총 73.4초 · 12 씬</span>
        </div>
        <div className="filmstrip row gap-1" style={{ overflow: 'hidden' }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} style={{
              flex: i === 3 || i === 5 ? 2 : 1.4,
              height: 38,
              background: i < 8 ? '#d6cda8' : '#5a5a5a',
              border: '1px solid var(--paper)',
              fontSize: 9,
              padding: 2,
              fontFamily: 'JetBrains Mono',
              color: i < 8 ? 'var(--ink)' : 'var(--paper)',
            }}>
              S{String(i+1).padStart(2,'0')}
            </div>
          ))}
        </div>
      </Box>

      <Sticky style={{ position: 'absolute', top: 80, right: 30, transform: 'rotate(1.5deg)' }}>
        편집자가 가장 보고 싶은 뷰<br />
        — 씬 단위로 모든 게 정렬됨
      </Sticky>
    </div>
  );
}

window.VariantSceneStrip = VariantSceneStrip;
