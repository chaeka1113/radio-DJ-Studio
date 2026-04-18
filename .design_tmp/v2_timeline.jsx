/* Variant 2 — PIPELINE TIMELINE: each step is a node; click expands */

function VariantTimeline() {
  const steps = [
    { id: '00t', icon: '🌐', ko: '트렌드',     status: 'ok', meta: '12 RSS · 28 토픽 수집' },
    { id: '00p', icon: '📋', ko: '플래너',     status: 'ok', meta: 'EP 계약서 생성' },
    { id: '01',  icon: '📝', ko: '대본',       status: 'ok', meta: '3 EP · 92/100' },
    { id: '01q', icon: '🔍', ko: 'QA 루프',    status: 'ok', meta: '시도 2/3 통과' },
    { id: '02',  icon: '🤖', ko: 'DJ 멘트',    status: 'ok', meta: '오프닝/연결/클로징' },
    { id: '03',  icon: '🎭', ko: '캐스팅',     status: 'ok', meta: '주역 3 · 보조 5' },
    { id: '04',  icon: '🎬', ko: '스토리보드', status: 'ok', meta: '12 씬' },
    { id: '04q', icon: '👁', ko: '시각 QA',    status: 'warn', meta: '경고 2건' },
    { id: '05',  icon: '🖼', ko: '이미지',     status: 'run', meta: '8/12 진행 중…' },
    { id: '07',  icon: '🎧', ko: 'TTS',        status: 'idle', meta: '대기' },
    { id: '06',  icon: '🎞', ko: 'CapCut',     status: 'idle', meta: '대기' },
    { id: '08',  icon: '💬', ko: '자막',       status: 'idle', meta: '대기' },
    { id: '99',  icon: '🧠', ko: '오답노트',   status: 'idle', meta: '대기' },
  ];

  return (
    <div className="canvas">
      <span className="canvas-label">안 ②  파이프라인 타임라인 — 노드 클릭 → 패널 열림</span>

      <div className="row between" style={{ marginBottom: 16 }}>
        <div>
          <div className="sk-h" style={{ fontSize: '1.6em' }}>EP_2026-04-18-1430</div>
          <div className="sk-label">시작 14:30:12 · 진행 07:24 · 9/13 단계 완료</div>
        </div>
        <div className="row gap-2 items-center">
          <Btn tiny>⏮ 이전 EP</Btn>
          <Btn tiny variant="primary">▶ 이어 실행</Btn>
          <Btn tiny>⏸ 일시정지</Btn>
        </div>
      </div>

      {/* Big horizontal timeline */}
      <Box className="p-4" style={{ marginBottom: 16, position: 'relative' }}>
        <div className="sk-label" style={{ marginBottom: 12 }}>전체 흐름</div>
        <div style={{ position: 'relative', paddingTop: 8, paddingBottom: 28 }}>
          {/* baseline */}
          <div style={{
            position: 'absolute', left: 30, right: 30, top: 50,
            height: 2,
            backgroundImage: 'linear-gradient(to right, var(--line) 50%, transparent 50%)',
            backgroundSize: '8px 2px',
          }} />
          <div className="row" style={{ justifyContent: 'space-between', position: 'relative' }}>
            {steps.map((s, i) => {
              const cl = s.status === 'run' ? 'accent' : s.status === 'warn' ? '' : '';
              return (
                <div key={s.id} className="col items-center" style={{ width: 88, position: 'relative' }}>
                  <Box className={`thin ${cl} center`} style={{
                    width: 56, height: 56, padding: 0, fontSize: 22,
                    background: s.status === 'ok' ? 'var(--paper-2)' : s.status === 'run' ? 'var(--accent)' : s.status === 'warn' ? '#fff7c2' : 'var(--paper)',
                    color: s.status === 'run' ? 'var(--paper)' : 'var(--ink)',
                    boxShadow: s.status === 'run' ? '0 0 0 4px rgba(217,74,26,0.2)' : 'none',
                  }}>
                    {s.icon}
                  </Box>
                  <div className="sk-mono" style={{ marginTop: 6, fontSize: 10 }}>{s.id}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 1 }}>{s.ko}</div>
                  <div className="sk-mono" style={{ fontSize: 9, color: 'var(--ink-soft)', textAlign: 'center', marginTop: 2, lineHeight: 1.2 }}>{s.meta}</div>
                </div>
              );
            })}
          </div>
          {/* progress overlay */}
          <CurlArrow
            d="M 50 80 Q 200 60 400 80 T 800 75"
            stroke="var(--accent)"
            w={900} h={100}
            style={{ position: 'absolute', top: 70, left: 0, opacity: 0.3 }}
          />
        </div>
        <Sticky style={{ position: 'absolute', top: -20, right: 20 }}>
          노드 클릭 → 아래 패널에서<br />그 단계 상세 보기 / 재실행
        </Sticky>
      </Box>

      {/* Bottom drawer — selected step (05 이미지) */}
      <div className="row gap-3" style={{ height: 480 }}>
        <Box className="p-3 flex-1">
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="row gap-2 items-center">
              <Box className="accent center" style={{ width: 32, height: 32, padding: 0 }}>🖼</Box>
              <div>
                <div className="sk-h" style={{ fontSize: '1.3em' }}>05 이미지 생성 <span className="scribble">진행 중</span></div>
                <div className="sk-label">Gemini 2.5 Flash Image · 16:9 · 8/12 완료</div>
              </div>
            </div>
            <div className="row gap-1">
              <Btn tiny>🔄 미생성만</Btn>
              <Btn tiny variant="accent">🗑 전체 재생성</Btn>
              <Btn tiny>📁 폴더</Btn>
            </div>
          </div>

          <div className="grid-4" style={{ marginTop: 8 }}>
            {Array.from({ length: 12 }).map((_, i) => {
              const status = i < 8 ? 'ok' : i === 8 ? 'run' : 'idle';
              return (
                <Box key={i} className="thin" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ position: 'relative' }}>
                    <Img label={status === 'ok' ? `S${String(i+1).padStart(2,'0')}` : status === 'run' ? '⏳' : '대기'} ratio="16/9" />
                    <div style={{ position: 'absolute', top: 4, right: 4 }}><Dot status={status} /></div>
                  </div>
                  <div style={{ padding: '4px 6px', fontSize: 10 }} className="sk-mono">
                    {status === 'ok' ? '2.4s · 1.2MB' : status === 'run' ? '생성 중…' : '큐 대기'}
                  </div>
                </Box>
              );
            })}
          </div>
        </Box>

        {/* Step inspector */}
        <div className="col gap-2" style={{ width: 320 }}>
          <Box className="p-3">
            <div className="sk-label">단계 정보</div>
            <div className="sk-h" style={{ fontSize: '1.2em', marginTop: 4 }}>run_05_images.mjs</div>
            <div className="divider-h" />
            <div className="sk-mono" style={{ fontSize: 11, lineHeight: 1.7 }}>
              입력: 04_storyboard.json<br />
              모델: gemini-2.5-flash-image<br />
              병렬: 4 동시<br />
              평균: 2.6s/씬<br />
              비용: $0.18 (예상)
            </div>
          </Box>
          <Box className="p-3">
            <div className="sk-label">의존성</div>
            <div className="col gap-1" style={{ marginTop: 6, fontSize: 12 }}>
              <div>📋 ref_visual_rules.md ✓</div>
              <div>🎭 03 캐스팅 결과 ✓</div>
              <div>🔒 character_seed (4명) ✓</div>
            </div>
          </Box>
          <Box className="p-3 dark flex-1">
            <div className="sk-label" style={{ color: 'var(--accent-soft)' }}>📟 이 단계 로그</div>
            <div className="sk-mono" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.6, color: 'var(--paper)' }}>
              <div>[14:35:11] S01 → ok 2.4s</div>
              <div>[14:35:14] S02 → ok 2.1s</div>
              <div>[14:35:18] S03 → ok 3.0s</div>
              <div>[14:35:22] S04 → ok 2.5s</div>
              <div style={{ color: '#f4a890' }}>[14:35:26] S05 → retry (503)</div>
              <div>[14:35:38] S05 → ok 2.8s</div>
              <div>[14:35:41] S06–S08 → ok</div>
              <div style={{ color: 'var(--accent-soft)' }}>[14:35:54] S09 시작…</div>
            </div>
          </Box>
        </div>
      </div>

      <Sticky style={{ position: 'absolute', top: 200, right: 40, transform: 'rotate(2deg)' }}>
        한눈에 — 어디서 막혔는지<br />
        / 어디까지 갔는지
      </Sticky>
    </div>
  );
}

window.VariantTimeline = VariantTimeline;
