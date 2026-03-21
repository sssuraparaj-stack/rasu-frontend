import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { API, WS } from '../App';

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

export default function HostSession() {
  const { sessionId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState(state?.session || null);
  const [slides, setSlides] = useState([]);
  const [currentSlide, setCurrentSlide] = useState(null); // snapshot from server
  const [participants, setParticipants] = useState([]);
  const [responses, setResponses] = useState({});
  const [leaderboard, setLeaderboard] = useState([]);
  const [status, setStatus] = useState(state?.session?.status || 'waiting');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showOverall, setShowOverall] = useState(false);
  const [slideLeaderboard, setSlideLeaderboard] = useState([]); // per-question scores
  const [prevLeaderboard, setPrevLeaderboard] = useState([]); // scores before this question
  const [showQR, setShowQR] = useState(false);
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    loadSession().then(sess => connectSocket(sess));
    return () => { socketRef.current?.disconnect(); if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  function startTimer(slide) {
    if (timerRef.current) clearInterval(timerRef.current);
    const limit = slide?.timeLimit;
    if (!limit) { setTimeLeft(null); return; }
    const shownAt = slide?.shownAt || Date.now();
    const tick = () => {
      const remaining = Math.max(0, limit - (Date.now() - shownAt) / 1000);
      setTimeLeft(Math.ceil(remaining));
      if (remaining <= 0) clearInterval(timerRef.current);
    };
    tick();
    timerRef.current = setInterval(tick, 250);
  }

  async function loadSession() {
    try {
      const res = await fetch(`${API}/sessions/${sessionId}`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) {
        setSession(data.data);
        setStatus(data.data.status);
        const sRes = await fetch(`${API}/slides?presentationId=${data.data.presentationId}`, { headers: authHeaders() });
        const sData = await sRes.json();
        if (sRes.ok) setSlides(sData.data?.items || sData.data || []);
        return data.data;
      }
    } catch {}
    return null;
  }

  function connectSocket(sess) {
    const token = localStorage.getItem('token');
    const socket = io(WS + '/session', { auth: { token }, transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      const joinCode = sess?.joinCode || state?.session?.joinCode || '';
      socket.emit('join_session', { joinCode, nickname: '__host__' });
    });

    socket.on('session:joined', (data) => {
      if (data.participants?.length) {
        setParticipants(data.participants.map(p => ({ id: p.participantId, name: p.nickname, score: p.score || 0 })));
      }
    });

    socket.on('session:started', (data) => {
      setStatus('active');
      setShowLeaderboard(false);
      const slide = data?.firstSlide || data?.slide || data?.currentSlide;
      if (slide) { setCurrentSlide(slide); startTimer(slide); }
    });

    socket.on('session:slide_changed', (data) => {
      const snap = data.slide || data.snapshot || data;
      setCurrentSlide(snap);
      setShowLeaderboard(false);
      startTimer(snap);
    });

    socket.on('session:participant_joined', (data) => {
      setParticipants(prev => {
        if (prev.find(p => p.id === data.participantId)) return prev;
        return [...prev, { id: data.participantId, name: data.nickname, score: 0 }];
      });
    });

    socket.on('session:participant_left', (data) => {
      setParticipants(prev => prev.filter(p => p.id !== data.participantId));
    });

    socket.on('session:results_update', (data) => {
      if (data.distribution !== undefined) {
        setResponses(prev => ({ ...prev, [data.slideId]: { distribution: data.distribution || {}, count: data.responseCount || 0, total: data.totalParticipants || 0 } }));
      }
    });

    // Track last leaderboard scores for per-question diff
    const lastLbScores = { current: {}, lastSlideIndex: -1 };

    socket.on('session:leaderboard', (data) => {
      const lb = data?.entries || data?.leaderboard || [];
      if (!lb.length) return;

      const slideIndex = data?.slideIndex ?? -1;

      // Ignore duplicate events for same slide
      if (slideIndex === lastLbScores.lastSlideIndex) {
        // Still update leaderboard silently
        setLeaderboard(lb);
        setParticipants(prev => prev.map(p => {
          const entry = lb.find(e => e.participantId === p.id);
          return entry ? { ...p, score: entry.score } : p;
        }));
        return;
      }
      lastLbScores.lastSlideIndex = slideIndex;

      // Calculate per-question points using stored previous scores
      const perQuestion = lb.map(entry => {
        const prevScore = lastLbScores.current[entry.participantId] ?? 0;
        const pointsThisQuestion = Math.max(0, entry.score - prevScore);
        return { ...entry, pointsThisQuestion };
      }).sort((a, b) => b.pointsThisQuestion - a.pointsThisQuestion);

      // Store current scores as "previous" for next question
      const newScores = {};
      lb.forEach(e => { newScores[e.participantId] = e.score; });
      lastLbScores.current = newScores;

      setSlideLeaderboard(perQuestion);
      setLeaderboard(lb);
      setShowLeaderboard(true);
      setShowOverall(false);
      setParticipants(prev => prev.map(p => {
        const entry = lb.find(e => e.participantId === p.id);
        return entry ? { ...p, score: entry.score } : p;
      }));
    });

    socket.on('session:ended', (data) => {
      setStatus('ended');
      const lb = data?.leaderboard?.entries || data?.entries || data?.leaderboard || [];
      if (lb.length) setLeaderboard(lb);
      setShowLeaderboard(true);
    });

    socket.on('session:error', (data) => console.error('Host socket error:', data));
  }

  function kickParticipant(participantId) {
    socketRef.current?.emit('kick_participant', { sessionId, participantId });
    setParticipants(prev => prev.filter(p => p.id !== participantId));
  }

  function startSession() {
    socketRef.current?.emit('start_session', { sessionId });
  }

  function changeSlide(direction) {
    setShowLeaderboard(false);
    socketRef.current?.emit('change_slide', { sessionId, direction });
  }

  function endSession() {
    socketRef.current?.emit('end_session', { sessionId });
  }

  const slideIdx = currentSlide?.slideIndex ?? 0;
  const totalSlides = currentSlide?.totalSlides ?? slides.length;
  const slideData = currentSlide;
  const options = slideData?.content?.options || [];
  const slideResponses = slideData ? (responses[slideData.slideId] || {}) : {};
  const distribution = slideResponses.distribution || {};
  const responseCount = slideResponses.count || 0;
  const totalParticipants = participants.length;

  return (
    <div className="host-layout">
      <div className="host-main">

        {/* Header */}
        <div className="session-header">
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>LIVE SESSION</div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800 }}>
              {session?.presentation?.title || 'Session'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="join-code-box" style={{ cursor: 'pointer' }} onClick={() => setShowQR(true)} title="Click to show QR code">
              <div className="join-code-label">Join Code · 📱 QR</div>
              <div className="join-code-value">{session?.joinCode || '------'}</div>
            </div>
            {status === 'waiting' && (
              <button className="btn btn-success" onClick={startSession} disabled={slides.length === 0}>
                ▶ Start
              </button>
            )}
            {status === 'active' && (
              <button className="btn btn-danger" onClick={endSession}>■ End</button>
            )}
          </div>
        </div>

        {/* Slide Display */}
        <div className="slide-display">
          {status === 'waiting' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Top bar */}
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
                  Waiting for students to join...
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                  Share code{' '}
                  <strong style={{ color: 'var(--accent)', fontSize: 18, letterSpacing: 2 }}>{session?.joinCode}</strong>
                  {' '}· {slides.length} slide{slides.length !== 1 ? 's' : ''} ready
                </div>
              </div>

              {/* Student grid */}
              {participants.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
                  <div style={{ fontSize: 52, marginBottom: 12 }}>👥</div>
                  <div style={{ fontSize: 15 }}>No students yet — waiting...</div>
                </div>
              ) : (
                <div className="waiting-student-grid">
                  {participants.map((p, i) => (
                    <div key={p.id} className="waiting-student-chip" style={{ animationDelay: `${i * 0.05}s` }}>
                      <div className="waiting-student-avatar">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="waiting-student-name">{p.name}</div>
                      <button
                        className="kick-btn"
                        title={`Remove ${p.name}`}
                        onClick={() => kickParticipant(p.id)}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              {participants.length > 0 && (
                <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 18 }}>{participants.length}</span>{' '}
                  student{participants.length !== 1 ? 's' : ''} ready
                </div>
              )}
            </div>
          )}

          {status === 'active' && !slideData && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>
              <div className="spinner" style={{ margin: '0 auto 16px' }} />
              <div>Starting session...</div>
            </div>
          )}

          {status === 'active' && slideData && !showLeaderboard && (
            <>
              {/* Slide progress bar */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: 'var(--muted)' }}>
                  <span style={{ fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--accent)' }}>
                    {slideData.type}
                  </span>
                  <span>Slide {slideIdx + 1} of {totalSlides}</span>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${((slideIdx + 1) / totalSlides) * 100}%`, transition: 'width 0.4s ease' }} />
                </div>
              </div>

              {slideData.content?.mediaUrl && (
                <div className="slide-image-wrap" style={{ marginBottom: 16 }}>
                  <img src={slideData.content.mediaUrl} alt="Slide" className="slide-image" />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className="slide-question" style={{ margin: 0 }}>{slideData.content?.question}</div>
                {timeLeft !== null && (
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
                    background: timeLeft <= 5 ? 'rgba(255,59,92,0.15)' : timeLeft <= 10 ? 'rgba(250,204,21,0.12)' : 'rgba(0,229,255,0.1)',
                    border: `2px solid ${timeLeft <= 5 ? 'var(--red)' : timeLeft <= 10 ? '#facc15' : 'var(--accent)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900,
                    color: timeLeft <= 5 ? 'var(--red)' : timeLeft <= 10 ? '#facc15' : 'var(--accent)',
                    transition: 'all 0.5s ease',
                  }}>
                    {timeLeft}
                  </div>
                )}
              </div>

              {/* Response rate */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{responseCount}</span>
                  /{totalParticipants} responded
                </div>
                {totalParticipants > 0 && (
                  <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                    <div style={{ height: '100%', background: 'var(--green)', borderRadius: 2, width: `${(responseCount / totalParticipants) * 100}%`, transition: 'width 0.3s ease' }} />
                  </div>
                )}
              </div>

              {/* Quiz / Poll — option bars */}
              {(slideData.type === 'quiz' || slideData.type === 'poll') && options.length > 0 && (
                <div className="poll-options">
                  {options.map(opt => {
                    const count = distribution[opt.id] || 0;
                    const pct = responseCount > 0 ? Math.round((count / responseCount) * 100) : 0;
                    return (
                      <div key={opt.id} className="poll-option" style={opt.isCorrect ? { borderColor: 'rgba(0,255,136,0.3)' } : {}}>
                        <div className="poll-option-bar" style={{ width: `${pct}%`, background: opt.isCorrect ? 'rgba(0,255,136,0.2)' : 'rgba(0,229,255,0.12)' }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 1 }}>
                          {opt.isCorrect && <span style={{ color: 'var(--green)', fontSize: 14 }}>✓</span>}
                          <span className="poll-option-text">{opt.text}</span>
                        </div>
                        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{count}</span>
                          <span className="poll-option-pct">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Word Cloud */}
              {slideData.type === 'wordcloud' && (
                <div style={{ minHeight: 120, padding: '20px 0' }}>
                  {Object.keys(distribution).length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Waiting for words...</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'center' }}>
                      {Object.entries(distribution)
                        .sort((a, b) => b[1] - a[1])
                        .map(([word, count]) => {
                          const maxCount = Math.max(...Object.values(distribution));
                          const size = 14 + Math.round((count / maxCount) * 28);
                          const opacity = 0.5 + (count / maxCount) * 0.5;
                          return (
                            <span key={word} style={{
                              fontSize: size, fontFamily: 'var(--font-head)', fontWeight: 800,
                              color: `rgba(0,229,255,${opacity})`,
                              padding: '4px 8px', transition: 'all 0.4s ease',
                            }}>
                              {word}
                              {count > 1 && <sup style={{ fontSize: 10, opacity: 0.6 }}> {count}</sup>}
                            </span>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

              {/* Q&A responses */}
              {slideData.type === 'qa' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                  {Object.keys(distribution).length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 20 }}>Waiting for responses...</div>
                  ) : (
                    Object.keys(distribution).map((resp, i) => (
                      <div key={i} style={{
                        padding: '10px 14px', borderRadius: 10,
                        background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                        fontSize: 14, color: 'var(--text)', lineHeight: 1.5,
                        animation: 'slideUp 0.3s ease',
                      }}>
                        💬 {resp}
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}

          {/* Mid-slide leaderboard */}
          {status === 'active' && showLeaderboard && (
            <div>
              {!showOverall ? (
                <>
                  {/* Per-question winner */}
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, marginBottom: 4, color: 'var(--accent)' }}>
                    ⚡ Question {slideIdx + 1} Results
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Points earned this question</div>
                  {slideLeaderboard.slice(0, 5).map((p, i) => (
                    <div key={p.participantId || i} style={{
                      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
                      padding: '10px 14px', borderRadius: 10,
                      background: i === 0 ? 'rgba(250,204,21,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${i === 0 ? 'rgba(250,204,21,0.25)' : 'var(--border)'}`,
                    }}>
                      <span style={{ fontSize: 18, width: 28 }}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
                      </span>
                      <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{p.nickname}</span>
                      <span style={{ fontFamily: 'var(--font-head)', fontWeight: 900, color: p.pointsThisQuestion > 0 ? 'var(--green)' : 'var(--muted)', fontSize: 16 }}>
                        {p.pointsThisQuestion > 0 ? `+${p.pointsThisQuestion}` : '0'}
                      </span>
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 12 }}
                    onClick={() => setShowOverall(true)}>
                    📊 Show Overall Rankings →
                  </button>
                </>
              ) : (
                <>
                  {/* Overall leaderboard */}
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
                    🏆 Overall Rankings
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Cumulative scores</div>
                  {leaderboard.slice(0, 5).map((p, i) => (
                    <div key={p.participantId || i} style={{
                      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
                      padding: '10px 14px', borderRadius: 10,
                      background: i === 0 ? 'rgba(250,204,21,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${i === 0 ? 'rgba(250,204,21,0.25)' : 'var(--border)'}`,
                    }}>
                      <span style={{ fontSize: 18, width: 28 }}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
                      </span>
                      <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{p.nickname}</span>
                      <span style={{ fontFamily: 'var(--font-head)', fontWeight: 900, color: 'var(--accent)', fontSize: 16 }}>
                        {p.score}
                      </span>
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 12 }}
                    onClick={() => setShowOverall(false)}>
                    ← Back to Question Results
                  </button>
                </>
              )}
            </div>
          )}

          {status === 'ended' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🏁</div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800 }}>Session Ended!</div>
            </div>
          )}
        </div>

        {/* Navigation Controls */}
        {status === 'active' && (
          <div className="slide-nav">
            <button
              className="btn btn-ghost btn-sm"
              disabled={slideIdx === 0}
              onClick={() => changeSlide('prev')}
            >
              ← Prev
            </button>

            {/* Slide dots */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => changeSlide(i)}
                  style={{
                    width: i === slideIdx ? 20 : 8,
                    height: 8,
                    borderRadius: 4,
                    border: 'none',
                    background: i === slideIdx ? 'var(--accent)' : i < slideIdx ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.15)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    padding: 0,
                  }}
                />
              ))}
            </div>

            <button
              className="btn btn-ghost btn-sm"
              disabled={!currentSlide || totalSlides === 0 || slideIdx >= totalSlides - 1}
              onClick={() => changeSlide('next')}
              style={slideIdx >= totalSlides - 1 ? { opacity: 0.3, cursor: 'not-allowed' } : {}}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Right Panel */}
      <aside className="host-panel">
        <div className="stat-grid">
          <div className="stat-box">
            <div className="stat-value">{participants.length}</div>
            <div className="stat-label">Students</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{responseCount}</div>
            <div className="stat-label">Responses</div>
          </div>
        </div>

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <>
            <div className="panel-section-title">Leaderboard</div>
            <div className="participant-list">
              {leaderboard.slice(0, 8).map((p, i) => (
                <div key={p.participantId || i} className="participant-item">
                  <span style={{ color: i < 3 ? 'var(--accent)' : 'var(--muted)', fontWeight: 700, width: 24, fontSize: 13 }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
                  </span>
                  <span className="participant-name">{p.nickname}</span>
                  <span className="participant-score">{p.score}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Participants (before leaderboard) */}
        {leaderboard.length === 0 && participants.length > 0 && (
          <>
            <div className="panel-section-title">Participants ({participants.length})</div>
            <div className="participant-list">
              {participants.map(p => (
                <div key={p.id} className="participant-item">
                  <span className="participant-name">{p.name}</span>
                  <span className="participant-score">{p.score} pts</span>
                </div>
              ))}
            </div>
          </>
        )}

        {participants.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
            <div style={{ fontSize: 13 }}>No students yet</div>
          </div>
        )}

        <div style={{ marginTop: 'auto' }}>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={() => navigate('/dashboard')}>
            ← Back to Dashboard
          </button>
        </div>
      </aside>

      {/* QR Code Modal */}
      {showQR && session?.joinCode && (
        <div className="modal-overlay" onClick={() => setShowQR(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360, textAlign: 'center' }}>
            <div className="modal-title">📱 Scan to Join</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Students scan this QR code to join the session
            </div>
            <div style={{ background: 'white', padding: 16, borderRadius: 12, display: 'inline-block', marginBottom: 16 }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://live.rasutechbridgeacademy.com/join?code=${session.joinCode}`)}`}
                alt="QR Code"
                style={{ width: 200, height: 200, display: 'block' }}
              />
            </div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 900, letterSpacing: 4, color: 'var(--accent)', marginBottom: 8 }}>
              {session.joinCode}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              live.rasutechbridgeacademy.com/join
            </div>
            <button className="btn btn-ghost" onClick={() => setShowQR(false)}>Close</button>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQR && session?.joinCode && (
        <div className="modal-overlay" onClick={() => setShowQR(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360, textAlign: 'center' }}>
            <div className="modal-title">📱 Scan to Join</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Students scan this QR code to join the session
            </div>
            <div style={{ background: 'white', padding: 16, borderRadius: 12, display: 'inline-block', marginBottom: 16 }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent('https://live.rasutechbridgeacademy.com/join?code=' + session.joinCode)}`}
                alt="QR Code"
                style={{ width: 200, height: 200, display: 'block' }}
              />
            </div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 900, letterSpacing: 4, color: 'var(--accent)', marginBottom: 8 }}>
              {session.joinCode}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              live.rasutechbridgeacademy.com/join
            </div>
            <button className="btn btn-ghost" onClick={() => setShowQR(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
