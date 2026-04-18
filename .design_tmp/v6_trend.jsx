/* Variant 6 — TREND CARDS: trend selection as the front door */

function VariantTrend() {
  const trends = [
    { rank: 1, ja: '年金支給 6月', ko: '6월 연금 지급', src: 'NHK · 朝日', n: 8, fit: 'senior', heat: 92 },
    { rank: 2, ja: '都内のラーメン値上げ', ko: '도쿄 라멘 가격 인상', src: '読売 · X', n: 6, fit: 'all', heat: 88 },
    { rank: 3, ja: '介護施設 不足', ko: '요양시설 부족', src: 'NHK', n: 7, fit: 'senior', heat: 85 },
    { rank: 4, ja: 'スマホ詐欺', ko: '스마트폰 사기', src: '産経 · NHK', n: 9, fit: 'senior', heat: 84 },
    { rank: 5, ja: 'Z世代の婚活アプリ', ko: 'Z세대 매칭 앱', src: 'X · 東洋経済', n: 12, fit: 'mz', heat: 82 },
    { rank: 6, ja: '昭和歌謡の再ブーム', ko: '쇼와 가요 재유행', src: 'NHK · TBS', n: 5, fit: 'senior', heat: 80 },
    { rank: 7, ja: '猫ブーム', ko: '고양이 붐', src: 'X', n: 14, fit: 'all', heat: 78 },
    { rank: 8, ja: '田舎暮らし移住', ko: '시골 이주', src: '日経', n: 4, fit: 'all', heat: 76 },
    { rank: 9, ja: '推し活と老後資金', ko: '덕질과 노후자금', src: '東洋経済', n: 6, fit: 'mz', heat: 73 },
  ];

  return (
    <div className="canvas">
      <span className="canvas-label">안 ⑥  트렌드 카드 — 주제 선택을 첫 화면으로</span>

      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <div className="sk-h" style={{ fontSize: '1.6em' }}>🌐 오늘의 일본 트렌드</div>
          <div className="sk-label">14:28 수집 · RSS 12개 · 28 토픽 · Claude 1차 정렬</div>
        </div>
        <div className="row gap-2">
          <Btn tiny>🔄 새로 수집</Btn>
          <Btn tiny>필터: 전체 ▾</Btn>
        </div>
      </div>

      {/* Cart bar — 3 selected slots */}
      <Box className="p-3 fill" style={{ marginBottom: 14, position: 'relative' }}>
        <div className="row gap-3 items-center">
          <div className="col" style={{ minWidth: 80 }}>
            <span className="sk-label">오늘 EP</span>
            <span className="sk-h" style={{ fontSize: '1.2em' }}>3 / 3 ✓</span>
          </div>
          {[
            { ja: '年金支給 6月',     ko: '6월 연금 지급',    fit: 'senior' },
            { ja: 'スマホ詐欺',       ko: '스마트폰 사기',     fit: 'senior' },
            { ja: 'Z世代の婚活アプリ',ko: 'Z세대 매칭 앱',     fit: 'mz' },
          ].map((t, i) => (
            <Box key={i} className="thin p-2 flex-1">
              <div className="row between" style={{ marginBottom: 2 }}>
                <span className="sk-mono" style={{ color: 'var(--accent)' }}>EP {i+1}</span>
                <Tag variant={t.fit === 'mz' ? 'accent' : ''}>{t.fit === 'mz' ? '🔥 MZ' : '👴 시니어'}</Tag>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t.ja}</div>
              <div className="sk-label">{t.ko}</div>
            </Box>
          ))}
          <div className="col gap-1">
            <Btn variant="primary">🎙 全工程 시작 →</Btn>
            <label className="row gap-1 items-center" style={{ fontSize: 11 }}>
              <input type="checkbox" defaultChecked /> Q&A 추가
            </label>
          </div>
        </div>
        <Sticky style={{ position: 'absolute', top: -12, right: 200, transform: 'rotate(-2deg)' }}>
          드래그해서 EP 자리에 떨어뜨리기
        </Sticky>
      </Box>

      {/* Trend grid */}
      <div className="grid-3 gap-3">
        {trends.map((t) => {
          const fitColor = t.fit === 'mz' ? 'var(--accent)' : t.fit === 'senior' ? 'var(--ok)' : 'var(--ink-soft)';
          return (
            <Box key={t.rank} className="thin p-3" style={{ borderLeft: `4px solid ${fitColor}` }}>
              <div className="row between items-center">
                <span className="sk-h" style={{ fontSize: '1.2em', color: 'var(--ink-soft)' }}>#{t.rank}</span>
                <Tag>{t.fit === 'mz' ? '🔥 MZ 적합' : t.fit === 'senior' ? '👴 시니어 적합' : '🌐 전체'}</Tag>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>{t.ja}</div>
              <div className="sk-label">{t.ko}</div>

              <div className="row gap-2 items-center" style={{ marginTop: 10 }}>
                <span className="sk-label">열기</span>
                <div className="row gap-1 flex-1" style={{ height: 8 }}>
                  <div style={{ width: `${t.heat}%`, background: 'var(--accent)', height: '100%', borderRadius: 2 }} />
                  <div style={{ flex: 1, background: 'var(--paper-2)', height: '100%', borderRadius: 2 }} />
                </div>
                <span className="sk-mono" style={{ fontSize: 10 }}>{t.heat}</span>
              </div>

              <div className="row between" style={{ marginTop: 8 }}>
                <span className="sk-mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{t.src} · {t.n}건</span>
                <Btn tiny variant="accent">+ EP 자리에</Btn>
              </div>
            </Box>
          );
        })}
      </div>

      <Sticky style={{ position: 'absolute', top: 90, right: 30, transform: 'rotate(1deg)' }}>
        파이프라인 시작 = 주제 고르기<br />
        AI 선별 + 사람 결정
      </Sticky>
    </div>
  );
}

window.VariantTrend = VariantTrend;
