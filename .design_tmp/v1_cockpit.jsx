/* Variant 1 — COCKPIT: dense single-screen control panel (refined)
   · scene gallery scrolls independently (handles 70+ scenes)
   · regenerate button on every scene card
   · tone: consistent accent usage, quieter neutrals in log */

function VariantCockpit() {
  // Mock a realistic scene set — mix of DJ shots and story scenes across 3 EPs
  const scenes = Array.from({ length: 24 }).map((_, i) => {
    const ep = Math.floor(i / 8) + 1;
    const idx = (i % 8) + 1;
    const isDj = idx === 1 || idx === 8;
    const types = ['ESTABLISHING', 'CHARACTER_SCENE', 'CLOSE_UP', 'FLASHBACK'];
    const type = isDj ? 'DJ_SHOT' : types[i % types.length];
    const speakers = {
      DJ_SHOT:         'TENKI_JII',
      ESTABLISHING:    '—',
      CHARACTER_SCENE: ['田中信夫', '佐藤美香', '鈴木健一'][ep - 1],
      CLOSE_UP:        ['田中信夫', '佐藤美香', '鈴木健一'][ep - 1],
      FLASHBACK:       ['田中(young)', '佐藤(young)', '鈴木(young)'][ep - 1],
    };
    const lines = [
      '昔は薬なんか飲まなくても…',
      '雨が降る秋の朝でね。',
      '妻が逝ってから台所が静かで。',
      '若い頃、毎朝畑に出ていた。',
      'なるほど、そういう話だね。',
      '年金だけじゃ足りんのよ。',
      '孫がスマホを教えてくれて。',
      '昭和のラジオが懐かしい。',
    ];
    // Stagger status: first ~14 done, 1 running, rest queued
    const status = i < 14 ? 'ok' : i === 14 ? 'run' : 'idle';
    return {
      id: `EP${ep}-S${String(idx).padStart(2, '0')}`,
      type,
      speaker: speakers[type],
      ja: lines[i % lines.length],
      status,
      ep,
    };
  });

  const typeColor = (t) => ({
    DJ_SHOT: 'var(--accent)',
    FLASHBACK: '#c98a1a',
    CLOSE_UP: '#7a4ec9',
    CHARACTER_SCENE: '#2d7a3e',
    ESTABLISHING: '#3a6ea5',
  })[t] || 'var(--ink-soft)';

  return (
    <div className="canvas">
      <span className="canvas-label">안 ①  콕핏 — 한 화면에 다 보이게 (개선)</span>

      {/* Header */}
      <div className="row between" style={{ marginBottom: 14 }}>
        <div className="row gap-3 items-center">
          <Box className="dark p-2" style={{ width: 44, height: 44 }}>
            <div className="center" style={{ height: '100%', fontSize: 22 }}>📻</div>
          </Box>
          <div>
            <div className="sk-h" style={{ fontSize: '1.5em' }}>テンキ爺 라디오 스튜디오</div>
            <div className="sk-label">EP_2026-04-18-1430 · 3 토픽 · 72 씬 · QA 92/100</div>
          </div>
        </div>
        <div className="row gap-2 items-center">
          <Tag>ガラクタロボ v3.2</Tag>
          <Btn tiny>EP 변경 ▾</Btn>
          <Btn tiny variant="primary">▶ 전체 실행</Btn>
        </div>
      </div>

      {/* Top: pipeline rail */}
      <Box className="p-3" style={{ marginBottom: 12 }}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="sk-label">파이프라인 진행</span>
          <span className="sk-mono" style={{ color: 'var(--ink-soft)' }}>07:24 경과 · 예상 02:30 남음</span>
        </div>
        <div className="row gap-1 items-center" style={{ overflow: 'hidden' }}>
          {PIPELINE_STEPS.map((s, i) => {
            const status = i < 8 ? 'ok' : i === 8 ? 'run' : 'idle';
            return (
              <React.Fragment key={s.id}>
                <Box className={`p-2 ${status === 'run' ? 'accent' : ''}`} style={{
                  minWidth: 74, textAlign: 'center',
                  background: status === 'ok' ? 'var(--paper-2)' : status === 'run' ? 'var(--accent)' : 'var(--paper)',
                  color: status === 'run' ? 'var(--paper)' : 'var(--ink)',
                }}>
                  <div style={{ fontSize: 16 }}>{s.icon}</div>
                  <div className="sk-mono" style={{ opacity: 0.8 }}>{s.id}</div>
                  <div style={{ fontSize: 11 }}>{s.ko}</div>
                  <div style={{ marginTop: 2 }}><Dot status={status} /></div>
                </Box>
                {i < PIPELINE_STEPS.length - 1 && <span className="sk-arrow" style={{ color: 'var(--ink-faint)' }}>→</span>}
              </React.Fragment>
            );
          })}
        </div>
      </Box>

      {/* Topic input row */}
      <Box className="p-3 fill" style={{ marginBottom: 12 }}>
        <div className="row gap-3 items-center">
          <span className="sk-label" style={{ minWidth: 70 }}>오늘 주제</span>
          {[
            { ja: '健康', ko: '건강' },
            { ja: '財テク', ko: '재테크' },
            { ja: 'ロマンス', ko: '로맨스' },
          ].map((t, i) => (
            <Box key={i} className="thin p-2 flex-1">
              <div className="sk-mono" style={{ color: 'var(--accent)' }}>テーマ {i + 1}</div>
              <div style={{ fontSize: '1.1em' }}>{t.ja}</div>
              <div className="sk-label">{t.ko}</div>
            </Box>
          ))}
          <div className="col gap-1">
            <label className="row gap-1 items-center" style={{ fontSize: '0.85em' }}>
              <input type="checkbox" defaultChecked /> MZ 사연 1개 섞기
            </label>
            <label className="row gap-1 items-center" style={{ fontSize: '0.85em' }}>
              <input type="checkbox" /> Q&A 코너
            </label>
          </div>
          <div className="col gap-1">
            <Btn variant="primary">🌐 트렌드 + 생성</Btn>
            <Btn>✍ 직접 입력</Btn>
          </div>
        </div>
      </Box>

      {/* 3-column main — fixed height so only gallery scrolls */}
      <div className="row gap-3" style={{ height: 620 }}>
        {/* Left — script editor stack */}
        <div className="col gap-2" style={{ width: '32%', minHeight: 0 }}>
          <Box className="p-3 flex-1" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <div className="row gap-2">
                <Tag variant="accent">📄 대본</Tag>
                <Tag>🤖 DJ멘트</Tag>
                <Tag>🎧 TTS</Tag>
              </div>
              <Btn tiny>💾 저장</Btn>
            </div>
            <div className="sk-mono" style={{
              background: 'var(--paper-2)', padding: 10, borderRadius: 4,
              fontSize: 11, lineHeight: 1.5, flex: 1, overflow: 'hidden',
            }}>
              <div style={{ color: 'var(--accent)' }}>━━━ EP1 ／ 健康 ／ 老人ホームの薬</div>
              <div style={{ color: 'var(--ink-soft)' }}>感情トーン: しっとり · 後悔</div>
              <div style={{ color: 'var(--ink-soft)' }}>主人公: 田中信夫 · 78歳 · 茨城</div>
              <br />
              <Lines n={14} />
            </div>
            <Btn tiny variant="ghost" style={{ marginTop: 8, alignSelf: 'flex-start' }}>🇰🇷 한국어로 번역</Btn>
          </Box>
          <Box className="p-2 thin">
            <div className="sk-label">QA 점수 추이 (재시도 3회)</div>
            <div className="row gap-2 items-center" style={{ marginTop: 4 }}>
              <span className="sk-mono" style={{ color: 'var(--bad)' }}>시도 1: 72</span>
              <span className="sk-arrow" style={{ color: 'var(--ink-faint)' }}>→</span>
              <span className="sk-mono" style={{ color: 'var(--warn)' }}>시도 2: 81</span>
              <span className="sk-arrow" style={{ color: 'var(--ink-faint)' }}>→</span>
              <span className="sk-mono" style={{ color: 'var(--ok)', fontWeight: 700 }}>시도 3: 92 ✓</span>
            </div>
          </Box>
        </div>

        {/* Mid — scene gallery (scrolls internally) */}
        <Box className="p-3 flex-1" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="row between items-center" style={{ marginBottom: 8 }}>
            <div className="row gap-2 items-center">
              <div className="sk-h" style={{ fontSize: '1.2em' }}>🖼 씬 갤러리</div>
              <Tag>EP1</Tag>
              <Tag>EP2</Tag>
              <Tag>EP3</Tag>
            </div>
            <div className="row gap-2 items-center">
              <span className="sk-mono" style={{ color: 'var(--ink-soft)' }}>14 / 72 씬 완료</span>
              <Btn tiny>🗑 전체 재생성</Btn>
            </div>
          </div>

          {/* Scroll region — only this scrolls */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            paddingRight: 6,
            minHeight: 0,
          }}>
            <div className="grid-3">
              {scenes.map((sc) => (
                <Box key={sc.id} className="thin" style={{
                  padding: 0,
                  overflow: 'hidden',
                  borderLeft: `3px solid ${typeColor(sc.type)}`,
                }}>
                  <div style={{ position: 'relative' }}>
                    {sc.status === 'ok' ? (
                      <Img label={sc.id} ratio="16/9" />
                    ) : sc.status === 'run' ? (
                      <Box className="thin center" style={{ aspectRatio: '16/9', background: 'var(--accent-soft)', border: 'none', borderRadius: 0 }}>
                        <span className="sk-mono">⏳ 생성 중…</span>
                      </Box>
                    ) : (
                      <Box className="dashed center" style={{ aspectRatio: '16/9', background: 'var(--paper-2)', border: 'none', borderRadius: 0 }}>
                        <span className="sk-mono" style={{ color: 'var(--ink-faint)' }}>대기</span>
                      </Box>
                    )}
                    <Tag
                      variant={sc.type === 'DJ_SHOT' ? 'accent' : ''}
                      style={{ position: 'absolute', top: 4, left: 4 }}
                    >
                      {sc.id}
                    </Tag>
                    <div style={{ position: 'absolute', top: 4, right: 4 }}>
                      <Dot status={sc.status} />
                    </div>
                  </div>
                  <div style={{ padding: '6px 8px' }}>
                    <div className="row between" style={{ marginBottom: 2 }}>
                      <span className="sk-mono" style={{ fontSize: 9, color: typeColor(sc.type), fontWeight: 700 }}>
                        {sc.type}
                      </span>
                      <span className="sk-mono" style={{ fontSize: 9, color: 'var(--ink-soft)' }}>{sc.speaker}</span>
                    </div>
                    <div style={{
                      fontSize: 11, lineHeight: 1.35,
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      minHeight: 30,
                    }}>
                      「{sc.ja}」
                    </div>
                    {/* Per-scene action row — regenerate always visible */}
                    <div className="row gap-1" style={{ marginTop: 6 }}>
                      <Btn tiny style={{ flex: 1 }}>🔄 재생성</Btn>
                      <Btn tiny variant="ghost">✏</Btn>
                      <Btn tiny variant="ghost">🔍</Btn>
                    </div>
                  </div>
                </Box>
              ))}
            </div>
          </div>
        </Box>

        {/* Right — log + status */}
        <div className="col gap-2" style={{ width: '26%', minHeight: 0 }}>
          <Box className="p-3 dark" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <span className="sk-label" style={{ color: 'var(--accent-soft)' }}>📟 실행 로그</span>
              <Dot status="run" />
            </div>
            <div className="sk-mono" style={{ fontSize: 10, lineHeight: 1.6, color: 'var(--paper)', flex: 1, overflowY: 'auto', minHeight: 0 }}>
              <div style={{ color: '#c9c9c9' }}>[14:30:12] ✍ Script 시도 1/3 시작</div>
              <div style={{ color: 'var(--accent-soft)' }}>[14:31:04] ❌ QA Fail (72/100)</div>
              <div style={{ color: '#c9c9c9' }}>[14:31:06] 🔄 Loop → 재작업 (2/3)</div>
              <div style={{ color: '#a0d0a0' }}>[14:32:18] ✅ QA Pass (92/100)</div>
              <div style={{ color: '#c9c9c9' }}>[14:32:20] 🤖 DJ 멘트 생성…</div>
              <div style={{ color: '#c9c9c9' }}>[14:33:45] 🎭 캐스팅 — 田中, 妻, MZ청취자</div>
              <div style={{ color: '#c9c9c9' }}>[14:34:02] 🎬 스토리보드 72 씬 생성</div>
              <div style={{ color: '#c9c9c9' }}>[14:35:11] 🖼 이미지 S01 → ok 2.4s</div>
              <div style={{ color: '#c9c9c9' }}>[14:35:14] 🖼 이미지 S02 → ok 2.1s</div>
              <div style={{ color: '#c9c9c9' }}>[14:35:18] 🖼 이미지 S03 → ok 3.0s</div>
              <div style={{ color: 'var(--accent-soft)' }}>[14:35:26] ⚠ S05 retry (503)</div>
              <div style={{ color: '#c9c9c9' }}>[14:35:38] 🖼 S05 → ok 2.8s</div>
              <div style={{ color: '#c9c9c9' }}>[14:35:54] 🖼 S15 생성 중…</div>
            </div>
          </Box>
          <Box className="p-3">
            <span className="sk-label">캐릭터 DNA 잠금</span>
            <div className="row gap-2" style={{ marginTop: 6 }}>
              <Img label="DJ" ratio="1/1" style={{ width: 52 }} />
              <Img label="田中" ratio="1/1" style={{ width: 52 }} />
              <Img label="妻" ratio="1/1" style={{ width: 52 }} />
              <Img label="청취자" ratio="1/1" style={{ width: 52 }} />
            </div>
            <div className="sk-mono" style={{ fontSize: 10, marginTop: 6, color: 'var(--ink-soft)' }}>
              4명 시드 잠김 · CHARACTER_LOCK 활성
            </div>
          </Box>
          <Box className="p-2 thin dashed">
            <div className="row between">
              <span className="sk-label">출력</span>
              <Tag>capcut/draft.json</Tag>
            </div>
            <div className="row gap-1" style={{ marginTop: 4 }}>
              <Btn tiny>🎞 CapCut</Btn>
              <Btn tiny>📁 폴더</Btn>
              <Btn tiny>💬 SRT</Btn>
            </div>
          </Box>
        </div>
      </div>
    </div>
  );
}

window.VariantCockpit = VariantCockpit;
