/* Variant 5 — EPISODE LIBRARY: history-first, list left + detail right */

function VariantLibrary() {
  const eps = [
    { id: '2026-04-18-1430', title: '老人ホームの薬', topics: '健康·財テク·ロマンス', qa: 92, dur: '3:42', status: 'run',  active: true,  tag: '진행 중' },
    { id: '2026-04-17-1820', title: '雨と昭和歌謡',     topics: '思い出·音楽·季節',     qa: 88, dur: '3:55', status: 'ok' },
    { id: '2026-04-16-1102', title: '年金が足りない夜', topics: '年金·節約·家族',       qa: 91, dur: '4:08', status: 'ok' },
    { id: '2026-04-15-0945', title: 'スマホと孫',        topics: 'テクノロジー·世代·愛',  qa: 86, dur: '3:30', status: 'ok' },
    { id: '2026-04-14-1715', title: '一人暮らしの台所', topics: '料理·孤独·健康',       qa: 78, dur: '3:50', status: 'warn', tag: '재시도 3회' },
    { id: '2026-04-13-2030', title: '昔の友、今の友',    topics: '友情·SNS·懐古',        qa: 90, dur: '4:15', status: 'ok' },
    { id: '2026-04-12-1340', title: '畑と空',            topics: '自然·季節·農業',       qa: 89, dur: '3:48', status: 'ok' },
    { id: '2026-04-11-1100', title: 'バス停の老婦人',    topics: '日常·交通·人情',       qa: 84, dur: '3:36', status: 'ok' },
  ];

  return (
    <div className="canvas">
      <span className="canvas-label">안 ⑤  에피소드 라이브러리 — 히스토리 중심</span>

      {/* Top bar */}
      <div className="row between" style={{ marginBottom: 14 }}>
        <div className="row gap-3 items-center">
          <div className="sk-h" style={{ fontSize: '1.5em' }}>📚 エピソード書庫</div>
          <Tag>총 28화 · 이번 달 12화</Tag>
        </div>
        <div className="row gap-2">
          <input placeholder="검색…" className="sk-mono" style={{
            border: '1.5px solid var(--line)', background: 'var(--paper)', padding: '4px 10px',
            borderRadius: 4, fontSize: 12, width: 180,
          }} />
          <Btn tiny>필터 ▾</Btn>
          <Btn tiny variant="primary">+ 새 EP 시작</Btn>
        </div>
      </div>

      <div className="row gap-3" style={{ height: 660 }}>
        {/* Left rail — episode list */}
        <Box className="p-2" style={{ width: 320, overflow: 'hidden' }}>
          <div className="sk-label" style={{ padding: '4px 6px' }}>최근 에피소드</div>
          <div className="col gap-1" style={{ overflowY: 'auto' }}>
            {eps.map((e) => (
              <div key={e.id} className="row gap-2 items-center" style={{
                padding: '8px 8px',
                borderRadius: 4,
                background: e.active ? 'var(--ink)' : 'transparent',
                color: e.active ? 'var(--paper)' : 'var(--ink)',
                border: e.active ? 'none' : '1px dashed transparent',
                borderBottom: e.active ? 'none' : '1px dashed #ddd',
              }}>
                <Dot status={e.status} />
                <div className="col flex-1" style={{ minWidth: 0 }}>
                  <div className="row between items-center">
                    <span className="sk-mono" style={{ fontSize: 9, opacity: 0.7 }}>{e.id.slice(5)}</span>
                    <span className="sk-mono" style={{ fontSize: 9, opacity: 0.7 }}>{e.dur}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.title}
                  </div>
                  <div className="sk-mono" style={{ fontSize: 9, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.topics}
                  </div>
                </div>
                <div className="col items-center" style={{ minWidth: 32 }}>
                  <span className="sk-h" style={{
                    fontSize: '1.1em',
                    color: e.qa >= 85 ? (e.active ? 'var(--accent-soft)' : 'var(--ok)') : 'var(--bad)',
                  }}>{e.qa}</span>
                  {e.tag && <span className="sk-mono" style={{ fontSize: 8, opacity: 0.7 }}>{e.tag}</span>}
                </div>
              </div>
            ))}
          </div>
        </Box>

        {/* Right — episode detail */}
        <div className="col flex-1 gap-3" style={{ overflow: 'hidden' }}>
          {/* Header */}
          <Box className="p-3 fill">
            <div className="row between">
              <div>
                <div className="sk-mono" style={{ color: 'var(--ink-soft)', fontSize: 11 }}>EP_2026-04-18-1430 · 진행 중 · 14:37:36</div>
                <div className="sk-h" style={{ fontSize: '1.7em' }}>老人ホームの薬</div>
                <div className="row gap-2" style={{ marginTop: 4 }}>
                  <Tag variant="accent">健康</Tag>
                  <Tag>財テク</Tag>
                  <Tag>ロマンス</Tag>
                  <Tag>🔥 MZ 1건</Tag>
                </div>
              </div>
              <div className="col" style={{ alignItems: 'flex-end' }}>
                <span className="gauge-num" style={{ color: 'var(--ok)' }}>92</span>
                <span className="sk-label">QA · 시도 2/3</span>
              </div>
            </div>
            {/* Pipeline strip */}
            <div className="row gap-1 items-center" style={{ marginTop: 12 }}>
              {PIPELINE_STEPS.map((s, i) => {
                const status = i < 8 ? 'ok' : i === 8 ? 'run' : 'idle';
                return (
                  <Box key={s.id} className={`thin center ${status === 'run' ? 'accent' : ''}`} style={{
                    flex: 1, padding: 4, fontSize: 13,
                    background: status === 'ok' ? 'var(--paper-2)' : status === 'run' ? 'var(--accent)' : 'var(--paper)',
                    color: status === 'run' ? 'var(--paper)' : 'var(--ink)',
                  }}>{s.icon}</Box>
                );
              })}
            </div>
          </Box>

          {/* Tabs */}
          <div className="row gap-1" style={{ marginBottom: -4 }}>
            {['📄 대본', '🎭 캐릭터 DNA', '🎬 스토리보드', '🔍 QA 루프', '🎧 오디오', '📊 통계'].map((t, i) => (
              <Box key={i} className={`thin ${i === 1 ? 'dark' : ''}`} style={{
                padding: '4px 12px',
                background: i === 1 ? 'var(--ink)' : 'var(--paper)',
                color: i === 1 ? 'var(--paper)' : 'var(--ink)',
                borderBottom: i === 1 ? 'none' : '1.5px solid var(--line)',
              }}>
                {t}
              </Box>
            ))}
          </div>

          {/* Active tab: Character DNA */}
          <Box className="p-3 flex-1" style={{ overflow: 'hidden' }}>
            <div className="sk-label" style={{ marginBottom: 8 }}>캐릭터 DNA — 잠금된 시드 (CHARACTER_LOCK)</div>
            <div className="grid-3 gap-3">
              {[
                { name: 'テンキ爺', role: 'DJ · 메인 진행', tag: 'tin robot · amber eye', n: 12 },
                { name: '田中信夫', role: 'EP1 주인공 · 78세', tag: 'gray hair · cardigan',  n: 4 },
                { name: '田中信夫(young)', role: 'EP1 회상 · 30대', tag: 'flashback override', n: 2 },
                { name: '佐藤美香',  role: 'EP2 주인공 · 65세', tag: 'kimono · spectacles',  n: 3 },
                { name: '鈴木健一', role: 'EP3 주인공 · 70세', tag: 'farmer · weathered',   n: 4 },
                { name: 'MZ 청취자 사연', role: 'MZ 사연 캐릭터 · 24세', tag: 'modern · earphones', n: 1 },
              ].map((c) => (
                <Box key={c.name} className="thin p-2">
                  <div className="row gap-2">
                    <Img label="시드" ratio="1/1" style={{ width: 64 }} />
                    <div className="col flex-1">
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{c.name}</div>
                      <div className="sk-label">{c.role}</div>
                      <div className="sk-mono" style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 4 }}>{c.tag}</div>
                      <div className="sk-mono" style={{ fontSize: 10, color: 'var(--accent)', marginTop: 4 }}>{c.n}개 씬에서 사용</div>
                    </div>
                  </div>
                  <div className="row gap-1" style={{ marginTop: 6 }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Img key={i} label="" ratio="1/1" style={{ flex: 1 }} />
                    ))}
                  </div>
                </Box>
              ))}
            </div>
          </Box>
        </div>
      </div>

      <Sticky style={{ position: 'absolute', top: 70, right: 40, transform: 'rotate(1deg)' }}>
        과거 회차 + 캐릭터 DNA<br />
        — 자료실 + 디테일 분리
      </Sticky>
    </div>
  );
}

window.VariantLibrary = VariantLibrary;
