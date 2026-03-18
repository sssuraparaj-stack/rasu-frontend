import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../App';

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

async function refreshToken() {
  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: localStorage.getItem('refreshToken') }),
    });
    const data = await res.json();
    if (res.ok && data.data?.accessToken) {
      localStorage.setItem('token', data.data.accessToken);
      return true;
    }
  } catch {}
  return false;
}

async function authFetch(url) {
  let res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) res = await fetch(url, { headers: authHeaders() });
  }
  return res;
}

function fmt(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function duration(start, end) {
  if (!start || !end) return '—';
  const ms = new Date(end) - new Date(start);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function SessionHistory() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => { loadSessions(); }, []);

  async function loadSessions() {
    setLoading(true);
    try {
      const res = await authFetch(`${API}/sessions/mine`);
      const data = await res.json();
      if (res.ok) {
        const list = Array.isArray(data.data) ? data.data : data.data?.items || [];
        const finished = list.filter(s => s.status === 'finished' || s.status === 'ended' || s.endedAt);
        const withTitles = await Promise.all(finished.map(async s => {
          if (s.presentation?.title) return s;
          try {
            const pr = await authFetch(`${API}/presentations/${s.presentationId}`);
            const pd = await pr.json();
            return { ...s, presentation: pd.data || pd };
          } catch { return s; }
        }));
        setSessions(withTitles);
      }
    } catch {}
    setLoading(false);
  }

  async function loadDetail(session) {
    setSelected(session);
    setDetail(null);
    setDetailLoading(true);
    try {
      const [lbRes, slidesRes] = await Promise.all([
        authFetch(`${API}/sessions/${session.id}/leaderboard?limit=50&source=live`),
        authFetch(`${API}/slides?presentationId=${session.presentationId}`),
      ]);
      const lbData = await lbRes.json();
      const slidesData = await slidesRes.json();
      const slides = slidesData.data?.items || slidesData.data || [];

      // leaderboard entries
      const entries = lbData.data?.entries || lbData.entries || [];

      const slideResults = await Promise.all(
        slides.map(async (s, i) => {
          try {
            const r = await authFetch(`${API}/slides/${s.id}/results?sessionId=${session.id}`);
            const d = await r.json();
            const raw = d.data || d;
          // Convert options array to distribution object expected by UI
          const distribution = {};
          const opts = raw.options || [];
          for (const o of opts) {
            distribution[o.optionId] = o.count;
          }
          return { ...s, results: { ...raw, distribution } };
          } catch { return { ...s, results: null }; }
        })
      );

      setDetail({ leaderboard: entries, slides: slideResults });
    } catch {}
    setDetailLoading(false);
  }

  function exportCSV() {
    if (!detail || !selected) return;

    const escape = val => {
      const s = String(val ?? '');
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""')+'"' : s;
    };

    const lines = [];
    lines.push('SESSION SUMMARY');
    lines.push(['Presentation', escape(selected.presentation?.title || 'Untitled')].join(','));
    lines.push(['Date', escape(fmt(selected.startedAt))].join(','));
    lines.push(['Duration', escape(duration(selected.startedAt, selected.endedAt))].join(','));
    lines.push(['Join Code', selected.joinCode].join(','));
    lines.push(['Total Students', detail.leaderboard.length].join(','));
    lines.push('');
    lines.push('LEADERBOARD');
    lines.push('Rank,Name,Score');
    detail.leaderboard.forEach((p, i) => {
      lines.push([i+1, escape(p.nickname || p.name || ''), p.score].join(','));
    });
    lines.push('');
    lines.push('QUESTION RESULTS');
    lines.push('Q#,Question,Type,Total Responses,A,B,C,D');
    detail.slides.forEach((slide, i) => {
      const opts = slide.content?.options || [];
      const dist = slide.results?.distribution || {};
      const total = Object.values(dist).reduce((a, b) => a + b, 0);
      const counts = ['a','b','c','d'].map(id => {
        const opt = opts.find(o => o.id === id);
        if (!opt) return '';
        const count = dist[opt.id] || dist[opt.optionId] || 0;
        const pct = total > 0 ? Math.round((count/total)*100) : 0;
        return escape(opt.text + ': ' + count + ' (' + pct + '%)' + (opt.isCorrect ? ' CORRECT' : ''));
      });
      lines.push([i+1, escape(slide.content?.question || slide.title), slide.type, total, ...counts].join(','));
    });

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (selected.presentation?.title || 'session') + '_' + selected.joinCode + '_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const statusColor = s => s.endedAt ? 'var(--green)' : s.status === 'active' ? 'var(--accent)' : 'var(--muted)';
  const statusLabel = s => s.endedAt ? 'Finished' : s.status === 'active' ? 'Live' : s.status;

  return (
    <div className="dash-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">RasuQuizz</div>
        <button className="sidebar-item" onClick={() => navigate('/dashboard')}><span className="icon">📊</span> Presentations</button>
        <button className="sidebar-item active"><span className="icon">📅</span> Sessions</button>
        <div className="sidebar-spacer" />
        <button className="sidebar-item" onClick={() => { localStorage.clear(); navigate('/login'); }}><span className="icon">🚪</span> Logout</button>
      </aside>

      <main className="dash-main" style={{ display: 'flex', gap: 0, padding: 0, overflow: 'hidden' }}>
        <div style={{ width: 340, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '28px 24px 20px', borderBottom: '1px solid var(--border)' }}>
            <div className="dash-title">Session History</div>
            <div className="dash-subtitle">{sessions.length} past sessions</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
            ) : sessions.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}>
                <div className="icon">📅</div>
                <h3>No sessions yet</h3>
                <p>Completed sessions will appear here.</p>
              </div>
            ) : sessions.map(s => (
              <div key={s.id} onClick={() => loadDetail(s)} style={{
                padding: '14px 16px', borderRadius: 12, cursor: 'pointer', marginBottom: 8,
                border: `1px solid ${selected?.id === s.id ? 'rgba(0,229,255,0.4)' : 'var(--border)'}`,
                background: selected?.id === s.id ? 'rgba(0,229,255,0.06)' : 'rgba(255,255,255,0.02)',
                transition: 'all 0.15s',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 800, flex: 1 }}>
                    {s.presentation?.title || 'Untitled'}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: statusColor(s), letterSpacing: 1, textTransform: 'uppercase', marginLeft: 8 }}>
                    {statusLabel(s)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{fmt(s.startedAt || s.createdAt)}</div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>⏱ {duration(s.startedAt, s.endedAt)}</span>
                  <span style={{ color: 'var(--muted)' }}>🔑 {s.joinCode}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
          {!selected && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, color: 'var(--muted)' }}>
              <div style={{ fontSize: 48 }}>📊</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Select a session to view results</div>
            </div>
          )}
          {selected && (
            <>
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>SESSION RESULTS</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 900, marginBottom: 8 }}>
                  {selected.presentation?.title || 'Untitled'}
                </div>
                <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--muted)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>📅 {fmt(selected.startedAt)}</span>
                  <span>⏱ {duration(selected.startedAt, selected.endedAt)}</span>
                  <span>🔑 {selected.joinCode}</span>
                  {detail && (
                    <button className="btn btn-ghost btn-sm" style={{ width: 'auto', marginLeft: 'auto', color: 'var(--green)', borderColor: 'rgba(0,255,136,0.3)' }} onClick={exportCSV}>
                      ⬇ Export CSV
                    </button>
                  )}
                </div>
              </div>
              {detailLoading && <div className="spinner" style={{ margin: '40px auto' }} />}
              {detail && (
                <>
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800, marginBottom: 16 }}>🏆 Final Leaderboard</div>
                    {detail.leaderboard.length === 0 ? (
                      <div style={{ color: 'var(--muted)', fontSize: 14 }}>No scores recorded.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {detail.leaderboard.slice(0, 10).map((p, i) => (
                          <div key={p.participantId || i} style={{
                            display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 12,
                            background: i === 0 ? 'rgba(250,204,21,0.08)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${i === 0 ? 'rgba(250,204,21,0.25)' : 'var(--border)'}`,
                          }}>
                            <span style={{ fontFamily: 'var(--font-head)', fontSize: 18, width: 32, textAlign: 'center' }}>
                              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
                            </span>
                            <span style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{p.nickname || p.name || '(no name)'}</span>
                            <span style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900, color: 'var(--accent)' }}>{p.score}</span>
                            <span style={{ fontSize: 12, color: 'var(--muted)' }}>pts</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800, marginBottom: 16 }}>📋 Slide Breakdown</div>
                    {detail.slides.length === 0 ? (
                      <div style={{ color: 'var(--muted)', fontSize: 14 }}>No slides found.</div>
                    ) : detail.slides.map((slide, i) => {
                      const opts = slide.content?.options || [];
                      const dist = slide.results?.distribution || {};
                      const total = Object.values(dist).reduce((a, b) => a + b, 0);
                      return (
                        <div key={slide.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px', marginBottom: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: 'var(--accent)', textTransform: 'uppercase' }}>Q{i+1} · {slide.type}</span>
                            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{total} response{total !== 1 ? 's' : ''}</span>
                          </div>
                          <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 700, marginBottom: 14 }}>
                            {slide.content?.question || slide.title}
                          </div>
                          {opts.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {opts.map(opt => {
                                const count = dist[opt.id] || dist[opt.optionId] || 0;
                                const pct = total > 0 ? Math.round((count/total)*100) : 0;
                                return (
                                  <div key={opt.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: `1px solid ${opt.isCorrect ? 'rgba(0,255,136,0.3)' : 'var(--border)'}` }}>
                                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: opt.isCorrect ? 'rgba(0,255,136,0.12)' : 'rgba(0,229,255,0.06)', transition: 'width 0.5s ease' }} />
                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 10 }}>
                                      {opt.isCorrect && <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>}
                                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{opt.text}</span>
                                      <span style={{ fontSize: 13, fontWeight: 700, color: opt.isCorrect ? 'var(--green)' : 'var(--muted)' }}>{pct}%</span>
                                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>({count})</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
