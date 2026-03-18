import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import { WS } from '../App';

export default function StudentSession() {
  const { sessionId } = useParams();
  const { state } = useLocation();
  const [currentSlide, setCurrentSlide] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState('waiting');
  const [leaderboard, setLeaderboard] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [joinedStudents, setJoinedStudents] = useState([]);
  const [kicked, setKicked] = useState(false);
  const [myAnswers, setMyAnswers] = useState([]); // { question, answer, isCorrect, points, type }
  const [showPersonalResults, setShowPersonalResults] = useState(false);
  const [correctOptionId, setCorrectOptionId] = useState(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [wordInputs, setWordInputs] = useState(['']);
  const socketRef = useRef(null);
  const slideStartTime = useRef(Date.now());
  const timerRef = useRef(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [timerExpired, setTimerExpired] = useState(false);

  const nickname = state?.nickname || localStorage.getItem('nickname') || 'Student';
  const participantId = state?.participant?.id || localStorage.getItem('participantId');
  const token = state?.participant?.token || localStorage.getItem('participantToken');
  // Validate we have what we need to reconnect
  const joinCode = state?.session?.joinCode || localStorage.getItem('joinCode');
  const sessionTheme = state?.session?.presentation?.theme || null;

  useEffect(() => {
    if (!sessionTheme) return;
    const root = document.documentElement;
    if (sessionTheme.primaryColor) root.style.setProperty('--accent', sessionTheme.primaryColor);
    if (sessionTheme.backgroundColor) root.style.setProperty('--bg', sessionTheme.backgroundColor);
    if (sessionTheme.fontFamily) root.style.setProperty('--font-head', sessionTheme.fontFamily + ', sans-serif');
    return () => {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--bg');
      root.style.removeProperty('--font-head');
    };
  }, []);
  const savedSessionId = localStorage.getItem('sessionId');

  useEffect(() => {
    // If previously kicked from this session, show kicked screen immediately
    if (localStorage.getItem('kicked_from') === sessionId) {
      setKicked(true);
      return;
    }
    // If no joinCode available at all, redirect to /join
    const code = state?.session?.joinCode || localStorage.getItem('joinCode');
    if (!code) {
      window.location.href = '/join';
      return;
    }
    connectSocket();
    return () => {
      socketRef.current?.disconnect();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const justChangedSlide = useRef(false);

  function startTimer(slide) {
    if (timerRef.current) clearInterval(timerRef.current);
    const limit = slide?.timeLimit;
    if (!limit) { setTimeLeft(null); return; }
    const shownAt = slide?.shownAt || Date.now();
    setTimerExpired(false);
    const tick = () => {
      const elapsed = (Date.now() - shownAt) / 1000;
      const remaining = Math.max(0, limit - elapsed);
      setTimeLeft(Math.ceil(remaining));
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        setTimerExpired(true);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 250);
  }

  function connectSocket() {
    const socket = io(WS + '/session', {
      auth: { token: token || '' },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      if (localStorage.getItem('kicked_from') === sessionId) {
        socket.disconnect();
        setKicked(true);
        return;
      }
      const code = state?.session?.joinCode || localStorage.getItem('joinCode') || '';
      socket.emit('join_session', { joinCode: code, nickname });
    });

    socket.on('session:joined', (data) => {
      // Restore state if rejoining mid-session (page refresh)
      if (data.currentSlide) {
        setStatus('active');
        setCurrentSlide(data.currentSlide);
        startTimer(data.currentSlide);
        setShowLeaderboard(false);
      }
      // Seed existing students if available
      if (data.participants?.length) {
        setJoinedStudents(data.participants.map(p => ({ id: p.participantId, name: p.nickname })));
      }
    });

    socket.on('session:participant_joined', (data) => {
      setJoinedStudents(prev => {
        if (prev.find(p => p.id === data.participantId)) return prev;
        return [...prev, { id: data.participantId, name: data.nickname }];
      });
    });

    socket.on('session:kicked', () => {
      localStorage.setItem('kicked_from', sessionId);
      localStorage.removeItem('joinCode');
      localStorage.removeItem('sessionId');
      setKicked(true);
      socket.disconnect();
    });

    socket.on('session:participant_left', (data) => {
      setJoinedStudents(prev => prev.filter(p => p.id !== data.participantId));
    });

    socket.on('session:started', (data) => {
      slideStartTime.current = Date.now();
      setStatus('active');
      setShowLeaderboard(false);
      if (data?.firstSlide) {
        setCurrentSlide(data.firstSlide);
        startTimer(data.firstSlide);
      }
    });

    socket.on('session:slide_changed', (data) => {
      const snap = data.slide || data.snapshot || data;
      slideStartTime.current = Date.now();
      justChangedSlide.current = true;
      setTimeout(() => { justChangedSlide.current = false; }, 1500);
      setCurrentSlide(snap);
      setSelectedAnswer(null);
      setSubmitted(false);
      setResult(null);
      setCorrectOptionId(null);
      setShowLeaderboard(false);
      setTextAnswer('');
      setWordInputs(['']);
      startTimer(snap);
    });

    socket.on('session:response_received', (data) => {
      setResult({ isCorrect: data.isCorrect, points: data.pointsAwarded || 0 });
      if (data.pointsAwarded > 0) setScore(s => s + data.pointsAwarded);
      // Find correct option from current slide if wrong
      if (data.isCorrect === false) {
        setCurrentSlide(prev => {
          const correct = prev?.content?.options?.find(o => o.isCorrect);
          if (correct) setCorrectOptionId(correct.id);
          return prev;
        });
      }
    });

    socket.on('session:leaderboard', (data) => {
      setLeaderboard(data.entries || data.leaderboard || []);
      // Don't show leaderboard if a new slide just arrived
      if (!justChangedSlide.current) setShowLeaderboard(true);
    });

    socket.on('session:ended', (data) => {
      setStatus('ended');
      const lb = data?.leaderboard?.entries || data?.entries || data?.leaderboard || [];
      if (lb.length) setLeaderboard(lb);
      setShowLeaderboard(false);
      setShowPersonalResults(true);
    });

    socket.on('session:error', (data) => console.error('Socket error:', data));
  }

  function submitWordCloud() {
    if (submitted || !currentSlide) return;
    const words = wordInputs.map(w => w.trim()).filter(Boolean);
    if (!words.length) return;
    setSubmitted(true);
    socketRef.current?.emit('submit_response', {
      sessionId,
      slideId: currentSlide.id || currentSlide.slideId,
      answer: words,
      responseTimeMs: Date.now() - slideStartTime.current,
    });
  }

  function submitTextAnswer() {
    if (submitted || !currentSlide || !textAnswer.trim()) return;
    setSubmitted(true);
    socketRef.current?.emit('submit_response', {
      sessionId,
      slideId: currentSlide.id || currentSlide.slideId,
      answer: textAnswer.trim(),
      responseTimeMs: Date.now() - slideStartTime.current,
    });
  }

  function submitAnswer(optionId) {
    if (submitted || !currentSlide) return;
    setSelectedAnswer(optionId);
    setSubmitted(true);
    const slideId = currentSlide.id || currentSlide.slideId;
    socketRef.current?.emit('submit_response', {
      sessionId,
      slideId,
      answer: optionId,
      responseTimeMs: Date.now() - slideStartTime.current,
    });
  }

  const options = currentSlide?.content?.options || [];
  const myEntry = leaderboard.find(p => p.participantId === participantId);
  const myRank = leaderboard.findIndex(p => p.participantId === participantId) + 1;

  function getOptionClass(opt) {
    if (!submitted) return 'answer-btn';
    if (opt.id === selectedAnswer) {
      if (result === null) return 'answer-btn selected';
      return result.isCorrect === true ? 'answer-btn correct' : 'answer-btn wrong';
    }
    if (result?.isCorrect === false && (opt.isCorrect || opt.id === correctOptionId)) {
      return 'answer-btn correct';
    }
    return 'answer-btn answer-btn-dim';
  }

  return (
    <div className="student-layout">
      <header className="student-header">
        <div className="student-name">👤 {nickname}</div>
        <div className="student-score">
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Score</span>
          <span className="score-badge">{score}</span>
        </div>
      </header>

      <div className="student-content">

        {/* WAITING */}
        {kicked && (
          <div className="waiting-screen" style={{ justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>🚫</div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, marginBottom: 8 }}>You were removed</div>
              <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24 }}>The host removed you from this session.</div>
              <button className="btn btn-primary" style={{ width: 'auto', margin: '0 auto' }} onClick={() => {
                localStorage.removeItem('kicked_from');
                window.location.href = '/join';
              }}>
                Join Another Session
              </button>
            </div>
          </div>
        )}

        {!kicked && status === 'waiting' && (
          <div className="waiting-screen" style={{ justifyContent: 'flex-start', paddingTop: 24 }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div className="waiting-icon">🎉</div>
              <div className="waiting-title">You're in!</div>
              <div style={{ display: 'inline-block', background: 'rgba(0,229,255,0.1)', border: '1px solid var(--accent)', borderRadius: 20, padding: '6px 18px', fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>
                {nickname}
              </div>
              <div className="waiting-subtitle">Waiting for the teacher to start...</div>
              {!state?.session && localStorage.getItem('joinCode') && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>↩ Reconnected</div>
              )}
            </div>

            {/* Other joined students */}
            {joinedStudents.length > 1 && (
              <div style={{ width: '100%' }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'center', marginBottom: 12 }}>
                  {joinedStudents.length} students joined
                </div>
                <div className="waiting-student-grid" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {joinedStudents.map((s, i) => (
                    <div key={s.id} className={`waiting-student-chip ${s.name === nickname ? 'is-me' : ''}`} style={{ animationDelay: `${i * 0.04}s` }}>
                      <div className="waiting-student-avatar" style={s.name === nickname ? { background: 'var(--accent)', color: '#000' } : {}}>
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="waiting-student-name">{s.name === nickname ? `${s.name} ★` : s.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ACTIVE - no slide yet */}
        {status === 'active' && !currentSlide && (
          <div className="waiting-screen">
            <div className="waiting-icon">📡</div>
            <div className="waiting-title">Get ready!</div>
            <div className="waiting-subtitle">First question coming up...</div>
          </div>
        )}

        {/* ACTIVE - question */}
        {status === 'active' && currentSlide && !showLeaderboard && (
          <div className="question-card">
            {/* Slide progress */}
            {currentSlide.totalSlides > 1 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--accent)' }}>{currentSlide.type}</span>
                  <span>Q {(currentSlide.slideIndex ?? 0) + 1} of {currentSlide.totalSlides}</span>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${(((currentSlide.slideIndex ?? 0) + 1) / currentSlide.totalSlides) * 100}%`, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            )}
            {currentSlide.totalSlides <= 1 && (
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: 'var(--accent)', marginBottom: 12, textTransform: 'uppercase' }}>
                {currentSlide.type}
              </div>
            )}
            {/* Timer */}
            {timeLeft !== null && (
              <div className="timer-ring-wrap">
                <svg className="timer-ring" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4"/>
                  <circle cx="28" cy="28" r="24" fill="none"
                    stroke={timeLeft <= 5 ? 'var(--red)' : timeLeft <= 10 ? '#facc15' : 'var(--accent)'}
                    strokeWidth="4"
                    strokeDasharray={`${2 * Math.PI * 24}`}
                    strokeDashoffset={`${2 * Math.PI * 24 * (1 - timeLeft / (currentSlide?.timeLimit || 30))}`}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.5s ease', transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
                  />
                </svg>
                <span className="timer-number" style={{ color: timeLeft <= 5 ? 'var(--red)' : timeLeft <= 10 ? '#facc15' : 'var(--text)' }}>
                  {timeLeft}
                </span>
              </div>
            )}

            {currentSlide.content?.mediaUrl && (
              <div className="slide-image-wrap">
                <img src={currentSlide.content.mediaUrl} alt="Question" className="slide-image" />
              </div>
            )}
            <div className="question-text">
              {currentSlide.content?.question || currentSlide.title}
            </div>

            {/* Multiple choice (quiz/poll) */}
            {(currentSlide.type === 'quiz' || currentSlide.type === 'poll') && options.length > 0 && (
              <div className="answer-grid">
                {options.map(opt => (
                  <button key={opt.id} className={getOptionClass(opt)} disabled={submitted || timerExpired} onClick={() => submitAnswer(opt.id)}>
                    {opt.text}
                  </button>
                ))}
              </div>
            )}

            {/* Word Cloud */}
            {currentSlide.type === 'wordcloud' && !submitted && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                {wordInputs.map((w, i) => (
                  <input key={i} className="text-answer-input" placeholder={`Word ${i+1}...`} value={w} maxLength={30}
                    onChange={e => { const next = [...wordInputs]; next[i] = e.target.value; setWordInputs(next); }}
                    onKeyDown={e => { if (e.key === 'Enter') submitWordCloud(); }}
                    disabled={timerExpired}
                  />
                ))}
                {wordInputs.length < (currentSlide.content?.maxWords || 3) && wordInputs[wordInputs.length-1].trim() && (
                  <button className="btn btn-ghost btn-sm" style={{ width: 'auto', alignSelf: 'flex-start' }}
                    onClick={() => setWordInputs(prev => [...prev, ''])}>+ Add word</button>
                )}
                <button className="btn btn-primary" onClick={submitWordCloud}
                  disabled={!wordInputs.some(w => w.trim()) || timerExpired}>
                  Submit ☁
                </button>
              </div>
            )}

            {/* Q&A */}
            {currentSlide.type === 'qa' && !submitted && (
              <div style={{ marginTop: 8 }}>
                <textarea className="text-answer-input" placeholder="Type your answer..." value={textAnswer}
                  onChange={e => setTextAnswer(e.target.value.slice(0, currentSlide.content?.maxResponseLength || 200))}
                  rows={4} disabled={timerExpired}
                  style={{ resize: 'vertical', fontFamily: 'var(--font-body)', fontSize: 15 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{textAnswer.length}/{currentSlide.content?.maxResponseLength || 200}</span>
                  <button className="btn btn-primary btn-sm" style={{ width: 'auto' }}
                    onClick={submitTextAnswer} disabled={!textAnswer.trim() || timerExpired}>
                    Submit →
                  </button>
                </div>
              </div>
            )}

            {/* Submitted state for open-ended */}
            {submitted && (currentSlide.type === 'wordcloud' || currentSlide.type === 'qa') && !result && (
              <div className="feedback-banner feedback-poll" style={{ justifyContent: 'center', marginTop: 16 }}>
                ✓ Response submitted!
              </div>
            )}

            {/* Feedback banner */}
            {timerExpired && !submitted && (
              <div className="feedback-banner feedback-wrong" style={{ justifyContent: 'center' }}>
                <div className="feedback-title">⏰ Time's up!</div>
              </div>
            )}

            {submitted && !result && (
              <div className="feedback-banner feedback-waiting">
                ⏱ Answer submitted — waiting for results...
              </div>
            )}

            {submitted && result && result.isCorrect === true && (
              <div className="feedback-banner feedback-correct">
                <div className="feedback-icon">✓</div>
                <div>
                  <div className="feedback-title">Correct!</div>
                  <div className="feedback-points">+{result.points} points</div>
                </div>
              </div>
            )}

            {submitted && result && result.isCorrect === false && (
              <div className="feedback-banner feedback-wrong">
                <div className="feedback-icon">✗</div>
                <div>
                  <div className="feedback-title">Incorrect</div>
                  <div className="feedback-points">The correct answer is highlighted</div>
                </div>
              </div>
            )}

            {submitted && result && result.isCorrect === null && (
              <div className="feedback-banner feedback-poll">
                <div className="feedback-icon">✓</div>
                <div>
                  <div className="feedback-title">Response recorded!</div>
                  <div className="feedback-points">This is a poll — no points awarded</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* LEADERBOARD / FINAL */}
        {showPersonalResults && (
          <div className="personal-results">
            <div className="personal-results-header">
              <div style={{ fontSize: 42, marginBottom: 8 }}>
                {myAnswers.length > 0 && myAnswers.filter(a => a.isCorrect).length / myAnswers.filter(a => a.type === 'quiz').length >= 0.8 ? '🏆' :
                 myAnswers.filter(a => a.isCorrect).length / Math.max(myAnswers.filter(a => a.type === 'quiz').length, 1) >= 0.5 ? '🎉' : '💪'}
              </div>
              <div className="personal-results-name">{nickname}</div>
              <div className="personal-results-score">{score} pts</div>
              {myEntry && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                  Rank #{myRank} of {leaderboard.length}
                </div>
              )}
            </div>

            {/* Summary stats */}
            {myAnswers.filter(a => a.type === 'quiz').length > 0 && (
              <div className="personal-results-stats">
                <div className="pr-stat">
                  <div className="pr-stat-val" style={{ color: 'var(--green)' }}>
                    {myAnswers.filter(a => a.isCorrect).length}
                  </div>
                  <div className="pr-stat-label">Correct</div>
                </div>
                <div className="pr-stat">
                  <div className="pr-stat-val" style={{ color: 'var(--red)' }}>
                    {myAnswers.filter(a => a.type === 'quiz' && !a.isCorrect).length}
                  </div>
                  <div className="pr-stat-label">Wrong</div>
                </div>
                <div className="pr-stat">
                  <div className="pr-stat-val" style={{ color: 'var(--accent)' }}>
                    {Math.round(myAnswers.filter(a => a.isCorrect).length / Math.max(myAnswers.filter(a => a.type === 'quiz').length, 1) * 100)}%
                  </div>
                  <div className="pr-stat-label">Accuracy</div>
                </div>
              </div>
            )}

            {/* Per-question breakdown */}
            {myAnswers.length > 0 && (
              <div className="pr-questions">
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>
                  Your Answers
                </div>
                {myAnswers.map((a, i) => (
                  <div key={i} className={`pr-question-row ${a.isCorrect === true ? 'correct' : a.isCorrect === false ? 'wrong' : 'open'}`}>
                    <div className="pr-q-icon">
                      {a.isCorrect === true ? '✓' : a.isCorrect === false ? '✗' : '💬'}
                    </div>
                    <div className="pr-q-text">{a.question}</div>
                    <div className="pr-q-points">
                      {a.points > 0 ? `+${a.points}` : a.type === 'quiz' ? '0' : '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Leaderboard toggle */}
            <button className="btn btn-ghost" style={{ marginTop: 16 }}
              onClick={() => { setShowPersonalResults(false); setShowLeaderboard(true); }}>
              View Leaderboard →
            </button>
          </div>
        )}

        {showLeaderboard && (
          <div className="leaderboard">
            <div className="lb-title">
              {status === 'ended' ? '🏆 Final Scores' : '📊 Leaderboard'}
            </div>

            {/* My result card on final */}
            {status === 'ended' && myEntry && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(0,229,255,0.15), rgba(0,229,255,0.05))',
                border: '1px solid var(--accent)', borderRadius: 16,
                padding: '20px 24px', marginBottom: 20, textAlign: 'center'
              }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>YOUR FINAL SCORE</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 48, fontWeight: 900, color: 'var(--accent)' }}>
                  {myEntry.score}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                  Rank #{myRank} of {leaderboard.length}
                </div>
              </div>
            )}

            {leaderboard.slice(0, 10).map((p, i) => (
              <div
                key={p.participantId || i}
                className={`lb-row ${p.participantId === participantId ? 'you' : ''}`}
                style={p.participantId === participantId ? { borderColor: 'var(--accent)', background: 'rgba(0,229,255,0.05)' } : {}}
              >
                <span className={`lb-rank ${i < 3 ? 'top' : ''}`}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </span>
                <span className="lb-name">
                  {p.nickname}
                  {p.participantId === participantId && (
                    <span style={{ color: 'var(--accent)', marginLeft: 6, fontSize: 11, fontWeight: 700 }}>YOU</span>
                  )}
                </span>
                <span className="lb-score">{p.score}</span>
              </div>
            ))}

            {myRank > 10 && (
              <div className="lb-row" style={{ borderColor: 'var(--accent)', background: 'rgba(0,229,255,0.05)', marginTop: 8 }}>
                <span className="lb-rank top">{myRank}</span>
                <span className="lb-name">{nickname} <span style={{ color: 'var(--accent)', fontSize: 11 }}>YOU</span></span>
                <span className="lb-score">{myEntry?.score || score}</span>
              </div>
            )}

            {!kicked && status === 'active' && (
              <div style={{ textAlign: 'center', marginTop: 20, color: 'var(--muted)', fontSize: 13 }}>
                ⏳ Waiting for next question...
              </div>
            )}

            {status === 'ended' && (
              <div style={{ textAlign: 'center', marginTop: 28 }}>
                <button className="btn btn-ghost" onClick={() => window.location.href = '/join'}>
                  Join Another Session
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
