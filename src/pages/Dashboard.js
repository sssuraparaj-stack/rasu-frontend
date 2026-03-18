import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../App';

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

export default function Dashboard() {
  const [presentations, setPresentations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ title: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // presentation to delete
  const navigate = useNavigate();

  useEffect(() => { loadPresentations(); }, []);

  async function loadPresentations() {
    setLoading(true);
    try {
      const res = await fetch(API + '/presentations', { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) { const d = data.data; setPresentations(Array.isArray(d) ? d : d?.items || d?.data || []); }
    } catch {}
    setLoading(false);
  }

  async function createPresentation(e) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch(API + '/presentations', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setModal(false);
        setForm({ title: '', description: '' });
        loadPresentations();
      }
    } catch {}
    setCreating(false);
  }

  async function deletePresentation(pres) {
    try {
      const res = await fetch(`${API}/presentations/${pres.id}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      if (res.ok) {
        setPresentations(prev => prev.filter(p => p.id !== pres.id));
      }
    } catch {}
    setDeleteConfirm(null);
  }

  async function startSession(presId, e) {
    e.stopPropagation();
    e.preventDefault();
    if (starting) return;
    setStarting(presId);
    try {
      const res = await fetch(API + '/sessions', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ presentationId: presId }),
      });
      const data = await res.json();
      if (res.ok) {
        navigate(`/host/${data.data.id}`, { state: { session: data.data } });
        return;
      }
      // If session already exists, extract the code and find the session
      const msg = data.message || '';
      const codeMatch = msg.match(/code:\s*([A-Z0-9]+)/);
      if (codeMatch) {
        // Find the existing session by code and navigate to it
        const codeRes = await fetch(API + '/sessions/code/' + codeMatch[1], { headers: authHeaders() });
        const codeData = await codeRes.json();
        if (codeRes.ok && codeData.data?.id) {
          navigate(`/host/${codeData.data.id}`, { state: { session: codeData.data } });
          return;
        }
      }
      alert('Error: ' + msg);
    } catch (err) {
      alert('Network error: ' + err.message);
    }
    setStarting(null);
  }

  function logout() {
    localStorage.clear();
    navigate('/login');
  }

  const user = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();

  return (
    <div className="dash-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">RasuQuizz</div>
        <button className="sidebar-item active">
          <span className="icon">📊</span> Presentations
        </button>
        <button className="sidebar-item" onClick={() => navigate('/history')}>
          <span className="icon">📅</span> Sessions
        </button>
        <button className="sidebar-item">
          <span className="icon">📈</span> Analytics
        </button>
        <div className="sidebar-spacer" />
        <button className="sidebar-item" onClick={logout}>
          <span className="icon">🚪</span> Logout
        </button>
      </aside>

      <main className="dash-main">
        <div className="dash-header">
          <div>
            <div className="dash-title">Presentations</div>
            <div className="dash-subtitle">
              {user.firstName ? `Welcome back, ${user.firstName}` : 'Manage your interactive presentations'}
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: 'auto' }} onClick={() => setModal(true)}>
            + New Presentation
          </button>
        </div>

        {loading ? (
          <div className="spinner" />
        ) : presentations.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📋</div>
            <h3>No presentations yet</h3>
            <p>Create your first interactive presentation to get started.</p>
            <br />
            <button className="btn btn-primary" style={{ width: 'auto', margin: '0 auto' }} onClick={() => setModal(true)}>
              Create Presentation
            </button>
          </div>
        ) : (
          <div className="card-grid">
            {presentations.map(p => (
              <div key={p.id} className="pres-card" onClick={() => {}}>
                <div className="pres-card-title">{p.title}</div>
                <div className="pres-card-desc">{p.description || 'No description'}</div>
                <div className="pres-card-meta">
                  <span className={`badge ${p.status === 'active' ? 'badge-active' : 'badge-draft'}`}>
                    {p.status || 'draft'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {p.slideCount || 0} slides
                  </span>
                </div>
                <div className="pres-card-actions">
                  <button className="btn btn-success btn-sm" style={{ flex: 1 }}
                    onClick={(e) => startSession(p.id, e)}
                    disabled={starting === p.id}>
                    {starting === p.id ? '...' : '▶ Start Session'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/editor/${p.id}`); }}>
                    ✏️ Edit
                  </button>
                  <button className="btn btn-danger btn-sm" style={{ width: 'auto', padding: '0 10px' }}
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(p); }}>
                    🗑
                  </button>
                </div>
              </div>
            ))}

            <div className="new-card" onClick={() => setModal(true)}>
              <div className="new-card-icon">+</div>
              <div className="new-card-label">New Presentation</div>
            </div>
          </div>
        )}
      </main>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">New Presentation</div>
            <form onSubmit={createPresentation}>
              <div className="field">
                <label>Title</label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Chapter 5 Quiz"
                  required autoFocus
                />
              </div>
              <div className="field">
                <label>Description (optional)</label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description..."
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-title">Delete Presentation?</div>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: '8px 0 24px' }}>
              "<strong style={{ color: 'var(--text)' }}>{deleteConfirm.title}</strong>" and all its slides will be permanently deleted. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deletePresentation(deleteConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
