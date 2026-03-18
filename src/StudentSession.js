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
  const [result, setResult] = useState(null); // { correct, points }
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState('waiting'); // waiting | active | ended
  const [leaderboard, setLeaderboard] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const socketRef = useRef(null);

  const nickname = state?.nickname || localStorage.getItem('nickname') || 'Student';
  const participantId = state?.participant?.id || localStorage.getItem('participantId');
  const token = state?.participant?.token || localStorage.getItem('participantToken');

  useEffect(() => {
    connectSocket();
    return () => socketRef.current?.disconnect();
  }, []);

  function connectSocket() {
    const socket = io(WS + '/session', {
      auth: { token: token || '' },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_session', { sessionId, nickname, role: 'participant' });
    });

    socket.on('session_started', () => {
      setStatus('active');
      setShowLeaderboard(false);
    });

    socket.on('slide_changed', (data) => {
      setCurrentSlide(data.slide);
      setSelectedAnswer(null);
      setSubmitted(false);
      setResult(null);
      setShowLeaderboard(false);
    });

    socket.on('response_accepted', (data) => {
      setResult({ correct: data.isCorrect, points: data.pointsEarned });
      if (data.isCorrect) setScore(s => s + (data.pointsEarned || 0));
    });

    socket.on('leaderboard_updated', (data) => {
      setLeaderboard(data.leaderboard || []);
      setShowLeaderboard(true);
    });

    socket.on('session_ended', () => {
      setStatus('ended');
      setShowLeaderboard(true);
    });

    socket.on('error', (data) => {
      console.error('Socket error:', data);
    });
  }

  function submitAnswer(optionId) {
    if (submitted || !currentSlide) return;
    setSelectedAnswer(optionId);
    setSubmitted(true);
    socketRef.current?.emit('submit_response', {
      sessionId,
      slideId: currentSlide.id,
      optionId,
      participantId,
    });
  }

  const options = currentSlide?.content?.options || [];
  const myRank = leaderboard.findIndex(p => p.participantId === participantId) + 1;

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
        {status === 'waiting' && (
          <div className="waiting-screen">
            <div className="waiting-icon">⏳</div>
            <div className="waiting-title">You're in!</div>
            <div className="waiting-subtitle">
              Waiting for the teacher to start the session...
            </div>
            <div style={{ marginTop: 20, color: 'var(--accent)', fontFamily: 'var(--font-head)', fontSize: 18 }}>
              {nickname}
            </div>
          </div>
        )}

        {status === 'active' && !currentSlide && (
          <div className="waiting-screen">
            <div className="waiting-icon">📡</div>
            <div className="waiting-title">Connected!</div>
            <div className="waiting-subtitle">The first question is coming up...</div>
          </div>
        )}

        {status === 'active' && currentSlide && !showLeaderboard && (
          <div className="question-card">
            <div className="question-text">
              {currentSlide.content?.question || currentSlide.title}
            </div>

            {options.length > 0 && (
              <div className="answer-grid">
                {options.map(opt => {
                  let cls = 'answer-btn';
                  if (submitted) {
                    if (opt.id === selectedAnswer) {
                      cls += result?.correct ? ' correct' : ' wrong';
                    }
                    if (currentSlide.content?.correctAnswer === opt.id && !result?.correct) {
                      cls += ' correct';
                    }
                  }
                  return (
                    <button key={opt.id} className={cls}
                      disabled={submitted}
                      onClick={() => submitAnswer(opt.id)}>
                      {opt.text}
                    </button>
                  );
                })}
              </div>
            )}

            {submitted && result && (
              <div style={{ marginTop: 24, padding: '16px', borderRadius: 12,
                background: result.correct ? 'rgba(0,255,136,0.1)' : 'rgba(255,59,92,0.1)',
                border: `1px solid ${result.correct ? 'var(--green)' : 'var(--red)'}`,
                color: result.correct ? 'var(--green)' : 'var(--red)',
                fontWeight: 700, fontSize: 16, textAlign: 'center' }}>
                {result.correct ? `✓ Correct! +${result.points} pts` : '✗ Incorrect'}
              </div>
            )}

            {submitted && !result && (
              <div style={{ marginTop: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
                ✓ Answer submitted — waiting for results...
              </div>
            )}
          </div>
        )}

        {showLeaderboard && (
          <div className="leaderboard">
            <div className="lb-title">
              {status === 'ended' ? '🏆 Final Scores' : '📊 Leaderboard'}
            </div>
            {leaderboard.slice(0, 10).map((p, i) => (
              <div key={p.participantId || i} className={`lb-row ${p.participantId === participantId ? 'you' : ''}`}
                style={p.participantId === participantId ? { borderColor: 'var(--accent)', background: 'rgba(0,229,255,0.05)' } : {}}>
                <span className={`lb-rank ${i < 3 ? 'top' : ''}`}>{i + 1}</span>
                <span className="lb-name">
                  {p.nickname}
                  {p.participantId === participantId && <span style={{ color: 'var(--accent)', marginLeft: 6, fontSize: 11 }}>YOU</span>}
                </span>
                <span className="lb-score">{p.score}</span>
              </div>
            ))}
            {myRank > 10 && (
              <div className="lb-row" style={{ borderColor: 'var(--accent)', background: 'rgba(0,229,255,0.05)', marginTop: 8 }}>
                <span className="lb-rank top">{myRank}</span>
                <span className="lb-name">{nickname} <span style={{ color: 'var(--accent)', fontSize: 11 }}>YOU</span></span>
                <span className="lb-score">{score}</span>
              </div>
            )}
            {status === 'ended' && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>Session ended</div>
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
