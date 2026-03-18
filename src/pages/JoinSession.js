import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../App';

export default function JoinSession() {
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [step, setStep] = useState('code'); // code | name
  const [sessionData, setSessionData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function lookupCode(e) {
    e.preventDefault();
    if (code.length < 4) return;
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/sessions/code/${code.toUpperCase()}`);
      const data = await res.json();
      if (!res.ok) throw new Error('Session not found. Check your code.');
      setSessionData(data.data);
      setStep('name');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function joinSession(e) {
    e.preventDefault();
    if (!nickname.trim()) return;
    // Students join via WebSocket directly — no REST join needed
    const nick = nickname.trim();
    localStorage.setItem('nickname', nick);
    localStorage.setItem('participantId', '');
    localStorage.setItem('participantToken', '');
    localStorage.setItem('joinCode', sessionData.joinCode || code.toUpperCase());
    localStorage.setItem('sessionId', sessionData.id);
    localStorage.setItem('sessionStatus', sessionData.status);
    navigate(`/play/${sessionData.id}`, { state: { session: sessionData, nickname: nick } });
  }

  return (
    <div className="join-page">
      <div className="join-box">
        <div className="join-logo">RasuQuizz</div>

        {step === 'code' ? (
          <>
            <div className="join-title">Join Session</div>
            <div className="join-subtitle">Enter the code shown on screen</div>
            {error && <div className="error-msg">{error}</div>}
            <form onSubmit={lookupCode}>
              <input
                className="code-input"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase().slice(0, 8))}
                placeholder="CODE"
                autoFocus
                maxLength={8}
              />
              <button className="btn btn-primary" type="submit" disabled={loading || code.length < 4}>
                {loading ? 'Looking up...' : 'Find Session →'}
              </button>
            </form>
            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <button className="btn btn-ghost btn-sm" style={{ width: '100%' }}
                onClick={() => window.location.href = '/login'}>
                Teacher? Sign In
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 8 }}>
              <span className="badge badge-active">● LIVE</span>
            </div>
            <div className="join-title">{sessionData?.presentation?.title || 'Live Session'}</div>
            <div className="join-subtitle">What should we call you?</div>
            {error && <div className="error-msg">{error}</div>}
            <form onSubmit={joinSession}>
              <div className="field" style={{ marginBottom: 16 }}>
                <input
                  value={nickname}
                  onChange={e => setNickname(e.target.value.slice(0, 20))}
                  placeholder="Your nickname"
                  autoFocus
                  maxLength={20}
                  style={{ fontSize: 20, textAlign: 'center', padding: '16px' }}
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading || !nickname.trim()}>
                {loading ? 'Joining...' : '🚀 Join Now'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm"
                style={{ width: '100%', marginTop: 10 }}
                onClick={() => { setStep('code'); setError(''); }}>
                ← Change Code
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
