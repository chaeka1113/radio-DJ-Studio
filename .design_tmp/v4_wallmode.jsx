/* Variant 4 — WALL MODE: fullscreen monitor for walking-away monitoring */

function VariantWallMode() {
  return (
    <div className="canvas" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
      <span className="canvas-label" style={{ background: 'var(--ink)', color: 'var(--paper) ' }}>안 ④  벽걸이 모드 — 모니터처럼 큰 진행 상태</span>

      {/* Top bar */}
      <div className="row between" style={{ marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: '0.15em', color: '#888' }}>EP_2026-04-18-1430 · 14:37:36</div>
          <div className="sk-h" style={{ fontSize: '2em', color: 'var(--paper)' }}>EP1: <span className="scribble">老人ホームの薬</span></div>
        </div>
        <div className="row gap-2 items-center">
          <span style={{ fontSize: '0.85em', color: '#aaa' }}>🔴 LIVE</span>
          <Btn tiny>⛶ 풀스크린</Btn>
          <Btn tiny>⏸</Btn>
        </div>
      </div>

      <div className="row gap-4" style={{ marginBottom: 18 }}>
        {/* Left: huge gauge + current step */}
        <div style={{ width: 380 }}>
          <Box className="p-4" style={{ background: '#222', borderColor: '#444', color: 'var(--paper)' }}>
            <div className="sk-label" style={{ color: '#888' }}>현재 단계 9/13</div>
            <div className="sk-h" style={{ fontSize: '2.4em', marginTop: 4, color: 'var(--accent-soft)' }}>🖼 이미지 생성</div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>run_05_images.mjs · 2.6s/씬 평균</div>

            <div className="divider-h" style={{ borderColor: '#444' }} />

            <div className="row between items-center">
              <div>
                <div className="gauge-num" style={{ color: 'var(--accent)' }}>67<span style={{ fontSize: '0.4em', color: '#aaa' }}>%</span></div>
                <div className="sk-mono" style={{ fontSize: 10, color: '#888' }}>8 / 12 씬 완료</div>
              </div>
              <div className="col gap-1" style={{ alignItems: 'flex-end' }}>
                <span className="sk-mono" style={{ fontSize: 11 }}>예상 02:30 남음</span>
                <span className="sk-mono" style={{ fontSize: 11, color: '#888' }}>경과 07:24</span>
              </div>
            </div>

            {/* progress bar — chunky */}
            <div style={{ marginTop: 12, height: 18, border: '1.5px solid var(--paper)', background: 'transparent', position: 'relative', borderRadius: 4 }}>
              <div style={{ position: 'absolute', inset: 2, width: '67%', background: 'var(--accent)' }} />
              <div className="sk-mono" style={{ position: 'absolute', inset: 0, textAlign: 'center', lineHeight: '18px', fontSize: 11, color: 'var(--paper)' }}>
                8 / 12
              </div>
            </div>
          </Box>

          {/* QA gauge */}
          <Box className="p-3" style={{ background: '#222', borderColor: '#444', color: 'var(--paper)', marginTop: 12 }}>
            <div className="sk-label" style={{ color: '#888' }}>QA 점수</div>
            <div className="row items-center between" style={{ marginTop: 4 }}>
              <span className="gauge-num" style={{ color: 'var(--ok)' }}>92</span>
              <div className="col" style={{ alignItems: 'flex-end' }}>
                <Tag variant="ok">PASS · 시도 2/3</Tag>
                <span className="sk-mono" style={{ fontSize: 10, color: '#888', marginTop: 4 }}>커트라인 85</span>
              </div>
            </div>
            <div className="row gap-1" style={{ marginTop: 8 }}>
              {[72, 81, 92].map((v, i) => (
                <div key={i} className="col items-center flex-1">
                  <div style={{
                    height: 28, width: '100%',
                    background: i === 2 ? 'var(--ok)' : i === 1 ? 'var(--warn)' : 'var(--bad)',
                    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                    color: 'var(--paper)', fontSize: 11, fontFamily: 'JetBrains Mono',
                  }}>{v}</div>
                  <span className="sk-mono" style={{ fontSize: 9, color: '#888', marginTop: 2 }}>시도 {i+1}</span>
                </div>
              ))}
            </div>
          </Box>

          <Box className="p-3" style={{ background: '#222', borderColor: '#444', color: 'var(--paper)', marginTop: 12 }}>
            <div className="sk-label" style={{ color: '#888' }}>오늘 토큰 / 비용</div>
            <div className="row between" style={{ marginTop: 4, alignItems: 'baseline' }}>
              <span className="sk-h" style={{ fontSize: '1.6em' }}>$1.24</span>
              <span className="sk-mono" style={{ fontSize: 11, color: '#888' }}>284k tok</span>
            </div>
            <div className="barchart" style={{ marginTop: 6, height: 28 }}>
              {[8,12,15,9,18,22,16,28,24,18,14,11].map((h, i) => (
                <div key={i} className="bar" style={{ height: h, background: i >= 8 ? 'var(--accent)' : '#666' }} />
              ))}
            </div>
          </Box>
        </div>

        {/* Center: pipeline strip + current scene */}
        <div className="col gap-3 flex-1">
          {/* Step train */}
          <Box className="p-3" style={{ background: '#1a1a1a', borderColor: '#444' }}>
            <div className="row gap-1 items-center" style={{ overflow: 'hidden' }}>
              {PIPELINE_STEPS.map((s, i) => {
                const isOk = i < 8;
                const isRun = i === 8;
                return (
                  <React.Fragment key={s.id}>
                    <div className="col items-center" style={{ flex: 1, opacity: isOk || isRun ? 1 : 0.35 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        border: `2px solid ${isRun ? 'var(--accent)' : isOk ? 'var(--ok)' : '#666'}`,
                        background: isRun ? 'var(--accent)' : isOk ? 'transparent' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16,
                        boxShadow: isRun ? '0 0 0 6px rgba(217,74,26,0.25)' : 'none',
                      }}>{isOk ? '✓' : s.icon}</div>
                      <div className="sk-mono" style={{ fontSize: 9, marginTop: 4, color: isRun ? 'var(--accent-soft)' : '#aaa' }}>{s.ko}</div>
                    </div>
                    {i < PIPELINE_STEPS.length - 1 && <span style={{ color: '#555' }}>—</span>}
                  </React.Fragment>
                );
              })}
            </div>
          </Box>

          {/* Currently rendering scene */}
          <Box className="p-3" style={{ background: '#222', borderColor: '#444', color: 'var(--paper)' }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <span className="sk-label" style={{ color: '#888' }}>지금 만드는 씬</span>
              <span className="sk-mono" style={{ fontSize: 11 }}>S09 / 12</span>
            </div>
            <div className="row gap-3">
              <div style={{ width: 320 }}>
                <Box className="thin center" style={{ aspectRatio: '16/9', background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}>
                  <span className="sk-mono" style={{ color: 'var(--ink)' }}>⏳ 렌더링 중…</span>
                </Box>
              </div>
              <div className="col flex-1 gap-2">
                <div>
                  <Tag variant="accent">FLASHBACK</Tag>
                  <Tag>田中(young)</Tag>
                </div>
                <div className="sk-h" style={{ fontSize: '1.3em', color: 'var(--paper)' }}>「若い頃は、毎朝畑に出ていた」</div>
                <div className="sk-mono" style={{ fontSize: 11, color: '#aaa', lineHeight: 1.6 }}>
                  Camera: medium shot, golden hour<br />
                  Style: Showa retro anime · sepia<br />
                  Lock: character_seed#02 (young Tanaka)
                </div>
              </div>
            </div>
            {/* Recent thumbnails */}
            <div className="row gap-1" style={{ marginTop: 12 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <Img key={i} label={`S0${i+1}`} ratio="16/9" style={{ flex: 1 }} />
              ))}
            </div>
          </Box>
        </div>

        {/* Right: live log + alerts */}
        <div className="col gap-3" style={{ width: 320 }}>
          <Box className="p-3" style={{ background: '#1a1a1a', borderColor: '#444', height: 320 }}>
            <div className="sk-label" style={{ color: '#888', marginBottom: 6 }}>📟 실시간 로그</div>
            <div className="sk-mono" style={{ fontSize: 10, lineHeight: 1.7, color: 'var(--paper)' }}>
              <div style={{ color: 'var(--accent-soft)' }}>14:35:54 ▶ S09 시작</div>
              <div>14:35:41 ✓ S08 ok 2.5s</div>
              <div>14:35:38 ✓ S07 ok 2.8s</div>
              <div>14:35:34 ✓ S06 ok 2.4s</div>
              <div style={{ color: '#f4a890' }}>14:35:26 ⚠ S05 retry (503)</div>
              <div>14:35:22 ✓ S04 ok 2.5s</div>
              <div>14:35:18 ✓ S03 ok 3.0s</div>
              <div>14:35:14 ✓ S02 ok 2.1s</div>
              <div>14:35:11 ✓ S01 ok 2.4s</div>
              <div style={{ color: '#888' }}>14:34:02 — 04 보드 12 씬 생성</div>
              <div style={{ color: '#888' }}>14:33:45 — 03 캐스팅 8 캐릭</div>
              <div style={{ color: '#888' }}>14:32:20 — 02 DJ 멘트</div>
            </div>
          </Box>

          <Box className="p-3" style={{ background: '#3a2a14', borderColor: 'var(--warn)', color: 'var(--paper)' }}>
            <div className="sk-label" style={{ color: 'var(--warn)' }}>⚠ 주의</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>시각 QA 경고 2건</div>
            <div className="sk-mono" style={{ fontSize: 10, color: '#ccc', marginTop: 4, lineHeight: 1.5 }}>
              · S05 캐릭터 일관성 낮음<br />
              · S08 텍스트 감지됨
            </div>
            <Btn tiny style={{ marginTop: 8 }}>자세히 보기 →</Btn>
          </Box>

          <Box className="p-3" style={{ background: '#1a1a1a', borderColor: '#444' }}>
            <div className="sk-label" style={{ color: '#888' }}>다음 자동 단계</div>
            <div className="col gap-1" style={{ marginTop: 6, fontSize: 12, color: '#ddd' }}>
              <div>→ 🎧 07 TTS</div>
              <div>→ 🎞 06 CapCut</div>
              <div>→ 💬 08 자막</div>
              <div>→ 🧠 99 오답노트</div>
            </div>
          </Box>
        </div>
      </div>

      <Sticky style={{ position: 'absolute', top: 60, right: 30, transform: 'rotate(-1deg)' }}>
        커피 마시러 가도 안심<br />
        — 멀리서도 보이는 큰 글씨
      </Sticky>
    </div>
  );
}

window.VariantWallMode = VariantWallMode;
