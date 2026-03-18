import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { API } from '../App';

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` };
}

const BLANK_QUIZ = () => ({
  type: 'quiz',
  title: '',
  content: {
    question: '',
    options: [
      { id: 'a', text: '', isCorrect: false },
      { id: 'b', text: '', isCorrect: false },
      { id: 'c', text: '', isCorrect: false },
      { id: 'd', text: '', isCorrect: false },
    ],
    points: 100,
    timeLimit: 30,
  },
});

const BLANK_WORDCLOUD = () => ({
  type: 'wordcloud',
  title: '',
  content: {
    question: '',
    maxWords: 3,
    timeLimit: 60,
    profanityFilter: true,
  },
});

const BLANK_QA = () => ({
  type: 'qa',
  title: '',
  content: {
    question: '',
    timeLimit: 0,
    maxResponseLength: 200,
    allowAnonymous: false,
    moderationEnabled: false,
  },
});

const BLANK_POLL = () => ({
  type: 'poll',
  title: '',
  content: {
    question: '',
    options: [
      { id: 'a', text: '' },
      { id: 'b', text: '' },
      { id: 'c', text: '' },
      { id: 'd', text: '' },
    ],
    timeLimit: 60,
  },
});

export default function SlideEditor() {
  const { presentationId } = useParams();
  const navigate = useNavigate();
  const [presentation, setPresentation] = useState(null);
  const [slides, setSlides] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [imageMode, setImageMode] = useState(null); // 'url' | 'upload'
  const [showTheme, setShowTheme] = useState(false);
  const [theme, setTheme] = useState(null);
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeSaved, setThemeSaved] = useState(false);

  const PRESETS = [
    { key: 'midnight', label: 'Midnight', bg: '#0F172A', primary: '#6366F1', font: 'DM Sans' },
    { key: 'ocean',    label: 'Ocean',    bg: '#0C1A2E', primary: '#00E5FF', font: 'DM Sans' },
    { key: 'forest',   label: 'Forest',   bg: '#0A1A0F', primary: '#00FF88', font: 'DM Sans' },
    { key: 'sunset',   label: 'Sunset',   bg: '#1A0A0A', primary: '#FF6B35', font: 'Poppins' },
    { key: 'grape',    label: 'Grape',    bg: '#1A0A2E', primary: '#C084FC', font: 'Poppins' },
    { key: 'slate',    label: 'Slate',    bg: '#1E293B', primary: '#38BDF8', font: 'Inter' },
    { key: 'rose',     label: 'Rose',     bg: '#1A0A10', primary: '#FB7185', font: 'Poppins' },
    { key: 'gold',     label: 'Gold',     bg: '#1A1400', primary: '#FACC15', font: 'DM Sans' },
  ];
  const FONTS = ['DM Sans', 'Poppins', 'Inter', 'Roboto', 'Montserrat', 'Oswald'];

  const [showAI, setShowAI] = useState(false);
  const [aiFile, setAiFile] = useState(null);
  const [aiFileText, setAiFileText] = useState('');
  const [aiInputMode, setAiInputMode] = useState('topic'); // 'topic' | 'document'
  const aiFileRef = React.useRef(null);
  const [aiTopic, setAiTopic] = useState('');
  const [aiCount, setAiCount] = useState(5);
  const [aiDifficulty, setAiDifficulty] = useState('medium');
  const [aiType, setAiType] = useState('quiz');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiPreview, setAiPreview] = useState(null); // generated questions before saving
  const [imageUrl, setImageUrl] = useState('');
  const fileInputRef = React.useRef(null);

  useEffect(() => { loadData(); }, [presentationId]);

  async function loadData() {
    setLoading(true);
    try {
      const [presRes, slidesRes] = await Promise.all([
        fetch(`${API}/presentations/${presentationId}`, { headers: authHeaders() }),
        fetch(`${API}/slides?presentationId=${presentationId}`, { headers: authHeaders() }),
      ]);
      const presData = await presRes.json();
      const slidesData = await slidesRes.json();
      if (presRes.ok) setPresentation(presData.data);
      if (slidesRes.ok) {
        const list = slidesData.data?.items || slidesData.data || [];
        setSlides(list);
        if (presData.theme) setTheme(presData.theme);
        else setTheme({ preset: 'midnight', primaryColor: '#6366F1', backgroundColor: '#0F172A', fontFamily: 'DM Sans', fontScale: 1, isDark: true });
        if (list.length > 0) setDraft(deepClone(list[0]));
        else setDraft(BLANK_QUIZ());
      }
    } catch {}
    setLoading(false);
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function selectSlide(idx) {
    setSelectedIdx(idx);
    setDraft(deepClone(slides[idx]));
    setSaved(false);
  }

  function addSlide(type) {
    const blank = type === 'poll' ? BLANK_POLL() : type === 'wordcloud' ? BLANK_WORDCLOUD() : type === 'qa' ? BLANK_QA() : BLANK_QUIZ();
    setDraft(blank);
    setSelectedIdx(slides.length);
    setSaved(false);
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      if (file.type === 'application/pdf') {
        // For PDF, read as base64 and send to Claude with document type
        const r2 = new FileReader();
        r2.onload = e => resolve({ type: 'pdf', data: e.target.result.split(',')[1] });
        r2.onerror = reject;
        r2.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  }

  async function handleAiFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setAiError('File must be under 5MB'); return; }
    setAiFile(file);
    setAiError('');
    try {
      const result = await readFileAsText(file);
      setAiFileText(result);
    } catch { setAiError('Could not read file. Try a .txt or .pdf file.'); }
  }

  async function generateQuestions() {
    if (aiInputMode === 'topic' && !aiTopic.trim()) return;
    if (aiInputMode === 'document' && !aiFile) return;
    setAiLoading(true);
    setAiError('');
    setAiPreview(null);
    try {
      const timeLimitMap = { easy: 20, medium: 30, hard: 45 };
      const timeLimit = timeLimitMap[aiDifficulty] || 30;
      const jsonFormat = `Return ONLY a valid JSON array, no markdown, no explanation.
Each item: {"question":"...","options":[{"id":"a","text":"...","isCorrect":false},{"id":"b","text":"...","isCorrect":true},{"id":"c","text":"...","isCorrect":false},{"id":"d","text":"...","isCorrect":false}],"timeLimit":${timeLimit},"points":100}
Rules: exactly one isCorrect:true per question, return ONLY the JSON array.`;

      const apiKey = localStorage.getItem('anthropic_key') || '';
      let messages;

      // Re-read file if needed
      let fileContent = aiFileText;
      if (aiInputMode === 'document' && !fileContent && aiFile) {
        fileContent = await readFileAsText(aiFile);
      }

      if (aiInputMode === 'import' && fileContent) {
        const importPrompt = `Extract ALL questions from this document and convert them to quiz format.

${jsonFormat}

Extract every question. Use marked answers as isCorrect. If no answers marked, use best judgment.`;
        if (fileContent.type === 'pdf') {
          messages = [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileContent.data } },
            { type: 'text', text: importPrompt },
          ]}];
        } else {
          const docContent = typeof fileContent === 'string' ? fileContent.slice(0, 8000) : '';
          messages = [{ role: 'user', content: `${importPrompt}

Document:
${docContent}` }];
        }
      } else if (aiInputMode === 'document' && fileContent) {
        if (fileContent.type === 'pdf') {
          // PDF: use document block
          messages = [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileContent.data } },
              { type: 'text', text: `Based on this document, generate exactly ${aiCount} ${aiDifficulty} difficulty quiz questions.

${jsonFormat}` },
            ],
          }];
        } else {
          // Plain text
          const docContent = typeof fileContent === 'string' ? fileContent.slice(0, 8000) : '';
          messages = [{
            role: 'user',
            content: `Here is a document:

${docContent}

Based on this document, generate exactly ${aiCount} ${aiDifficulty} difficulty quiz questions.

${jsonFormat}`,
          }];
        }
      } else {
        messages = [{
          role: 'user',
          content: `Generate exactly ${aiCount} ${aiDifficulty} quiz questions about: ${aiTopic}

${jsonFormat}`,
        }];
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 4000,
          messages,
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.[0]?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const questions = JSON.parse(clean);
      if (!Array.isArray(questions) || questions.length === 0) throw new Error('No questions returned');
      setAiPreview(questions);
    } catch (err) {
      setAiError('Failed to generate questions. Please try again.');
    }
    setAiLoading(false);
  }

  async function saveAIQuestions() {
    if (!aiPreview?.length) return;
    setAiLoading(true);
    try {
      for (const q of aiPreview) {
        const body = {
          presentationId,
          type: 'quiz',
          title: q.question,
          content: {
            question: q.question,
            options: q.options.map(o => ({ ...o, id: crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : o.id })),
            timeLimit: q.timeLimit || 30,
            points: q.points || 100,
            allowMultiple: false,
          },
        };
        const res = await fetch(`${API}/slides`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
        const d = await res.json();
        if (res.ok) setSlides(prev => [...prev, d.data]);
      }
      setShowAI(false);
      setAiPreview(null);
      setAiTopic('');
    } catch {}
    setAiLoading(false);
  }

  async function saveTheme() {
    if (!theme) return;
    setSavingTheme(true);
    try {
      const res = await fetch(`${API}/presentations/${presentationId}`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ theme }),
      });
      if (res.ok) { setThemeSaved(true); setTimeout(() => setThemeSaved(false), 2000); }
    } catch {}
    setSavingTheme(false);
  }

  function applyPreset(preset) {
    setTheme(t => ({ ...t, preset: preset.key, primaryColor: preset.primary, backgroundColor: preset.bg, fontFamily: preset.font }));
  }

  function openImagePicker() { setImageMode('url'); setImageUrl(draft?.content?.mediaUrl || ''); }

  function removeImage() {
    setDraft(d => ({ ...d, content: { ...d.content, mediaUrl: undefined } }));
    setSaved(false);
  }

  function applyImageUrl() {
    if (!imageUrl.trim()) return;
    setDraft(d => ({ ...d, content: { ...d.content, mediaUrl: imageUrl.trim() } }));
    setImageMode(null);
    setSaved(false);
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2MB'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      setDraft(d => ({ ...d, content: { ...d.content, mediaUrl: ev.target.result } }));
      setImageMode(null);
      setSaved(false);
    };
    reader.readAsDataURL(file);
  }

  async function saveSlide() {
    if (!draft) return;
    setSaving(true);
    try {
      const isNew = !draft.id;
      const body = isNew
        ? { presentationId, type: draft.type, title: draft.content.question || draft.title || 'Untitled', content: draft.content }
        : { title: draft.content.question || draft.title || 'Untitled', content: draft.content };
      const url = isNew ? `${API}/slides` : `${API}/slides/${draft.id}`;
      const method = isNew ? 'POST' : 'PATCH';
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        const saved = data.data;
        let newIdx = selectedIdx;
        setSlides(prev => {
          const next = [...prev];
          if (isNew) {
            next.push(saved);
            newIdx = next.length - 1;
          } else {
            next[selectedIdx] = saved;
          }
          return next;
        });
        setDraft(deepClone(saved));
        if (isNew) setSelectedIdx(newIdx);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {}
    setSaving(false);
  }

  async function deleteSlide(slideId, idx) {
    try {
      await fetch(`${API}/slides/${slideId}`, { method: 'DELETE', headers: authHeaders() });
      const next = slides.filter((_, i) => i !== idx);
      setSlides(next);
      const newIdx = Math.min(idx, next.length - 1);
      setSelectedIdx(newIdx);
      setDraft(next.length > 0 ? deepClone(next[newIdx]) : BLANK_QUIZ());
      setDeleteConfirm(null);
    } catch {}
  }

  function updateQuestion(val) {
    setDraft(d => ({ ...d, title: val, content: { ...d.content, question: val } }));
    setSaved(false);
  }

  function updateOption(idx, field, val) {
    setDraft(d => {
      const opts = d.content.options.map((o, i) => i === idx ? { ...o, [field]: val } : o);
      return { ...d, content: { ...d.content, options: opts } };
    });
    setSaved(false);
  }

  function setCorrect(optId) {
    setDraft(d => {
      const opts = d.content.options.map(o => ({ ...o, isCorrect: o.id === optId }));
      return { ...d, content: { ...d.content, options: opts } };
    });
    setSaved(false);
  }

  function updateMeta(field, val) {
    setDraft(d => ({ ...d, content: { ...d.content, [field]: val } }));
    setSaved(false);
  }

  function addOption() {
    setDraft(d => {
      const ids = ['a','b','c','d','e','f'];
      const newId = ids[d.content.options.length] || `opt${d.content.options.length}`;
      return { ...d, content: { ...d.content, options: [...d.content.options, { id: newId, text: '', isCorrect: false }] } };
    });
  }

  function removeOption(idx) {
    setDraft(d => ({
      ...d,
      content: { ...d.content, options: d.content.options.filter((_, i) => i !== idx) }
    }));
  }

  const isNew = !draft?.id;
  const correctCount = draft?.content?.options?.filter(o => o.isCorrect)?.length || 0;

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}><div className="spinner" /></div>;

  return (
    <div className="editor-layout">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="editor-sidebar">
        <div className="editor-sidebar-header">
          <button className="editor-back-btn" onClick={() => navigate('/dashboard')}>← Dashboard</button>
          <div className="editor-pres-title">{presentation?.title || 'Untitled'}</div>
        </div>

        <div className="editor-slides-list">
          {slides.map((s, i) => (
            <div
              key={s.id}
              className={`editor-slide-thumb ${selectedIdx === i && draft?.id ? 'active' : ''}`}
              onClick={() => selectSlide(i)}
            >
              <div className="thumb-num">{i + 1}</div>
              <div className="thumb-body">
                <div className="thumb-type">{s.type}</div>
                <div className="thumb-q">{s.content?.question || s.title || 'Untitled slide'}</div>
              </div>
              <button className="thumb-delete" onClick={e => { e.stopPropagation(); setDeleteConfirm({ id: s.id, idx: i }); }}>×</button>
            </div>
          ))}

          <div className="editor-add-btns">
            <button className="editor-add-btn" onClick={() => addSlide('quiz')}>
              <span>+</span> Quiz
            </button>
            <button className="editor-add-btn editor-add-poll" onClick={() => addSlide('poll')}>
              <span>+</span> Poll
            </button>
            <button className="editor-add-btn editor-add-wordcloud" onClick={() => addSlide('wordcloud')}>
              <span>+</span> Cloud
            </button>
            <button className="editor-add-btn editor-add-qa" onClick={() => addSlide('qa')}>
              <span>+</span> Q&A
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Editor ─────────────────────────────── */}
      <main className="editor-main">
        <div className="editor-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto', marginLeft: 'auto', background: 'rgba(167,139,250,0.1)', borderColor: 'rgba(167,139,250,0.3)', color: '#a78bfa' }} onClick={() => setShowAI(true)}>
            ✨ AI Generate
          </button>
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => setShowTheme(t => !t)}>
            🎨 Theme
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className={`editor-type-badge type-${draft?.type || 'quiz'}`}>{draft?.type || 'quiz'}</div>
            {isNew && <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>● UNSAVED</span>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {draft?.type === 'quiz' && (
              <div style={{ fontSize: 12, color: correctCount === 1 ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {correctCount === 1 ? '✓ Correct answer set' : '⚠ Select the correct answer'}
              </div>
            )}
            {(draft?.type === 'wordcloud' || draft?.type === 'qa') && (
              <div style={{ fontSize: 12, color: 'var(--accent)' }}>☁ Open-ended — no correct answer</div>
            )}
            <button
              className={`btn btn-sm ${saved ? 'btn-success' : 'btn-primary'}`}
              style={{ width: 'auto', minWidth: 100 }}
              onClick={saveSlide}
              disabled={saving}
            >
              {saving ? 'Saving...' : saved ? '✓ Saved!' : isNew ? 'Add Slide' : 'Save Changes'}
            </button>
          </div>
        </div>

        {draft && (
          <div className="editor-form">
            {/* Question */}
            <div className="editor-field">
              <label className="editor-label">Question</label>
              <textarea
                className="editor-textarea"
                placeholder="Type your question here..."
                value={draft.content?.question || ''}
                onChange={e => updateQuestion(e.target.value)}
                rows={3}
              />
            </div>

            {/* Image */}
            <div className="editor-field">
              <label className="editor-label">Image (optional)</label>
              {draft.content?.mediaUrl ? (
                <div className="image-preview-wrap">
                  <img src={draft.content.mediaUrl} alt="Slide" className="image-preview" onError={e => e.target.style.display='none'} />
                  <div className="image-preview-actions">
                    <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={openImagePicker}>Change</button>
                    <button className="btn btn-danger btn-sm" style={{ width: 'auto' }} onClick={removeImage}>Remove</button>
                  </div>
                </div>
              ) : (
                <div className="image-dropzone" onClick={() => setImageMode('url')}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🖼</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Add an image</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Paste URL or upload file</div>
                </div>
              )}
            </div>

            {/* Options - for quiz and poll */}
            {(draft.type === 'quiz' || draft.type === 'poll') && (
              <div className="editor-field">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <label className="editor-label" style={{ marginBottom: 0 }}>
                    Answer Options
                    {draft.type === 'quiz' && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>click ● to set correct</span>}
                  </label>
                  {(draft.content?.options?.length || 0) < 6 && (
                    <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={addOption}>+ Add Option</button>
                  )}
                </div>
                <div className="editor-options">
                  {draft.content?.options?.map((opt, i) => (
                    <div key={opt.id} className={`editor-option ${opt.isCorrect ? 'is-correct' : ''}`}>
                      {draft.type === 'quiz' && (
                        <button className={`correct-radio ${opt.isCorrect ? 'checked' : ''}`} onClick={() => setCorrect(opt.id)}>{opt.isCorrect ? '✓' : ''}</button>
                      )}
                      <div className="option-letter">{opt.id.toUpperCase()}</div>
                      <input className="option-input" placeholder={`Option ${opt.id.toUpperCase()}...`} value={opt.text} onChange={e => updateOption(i, 'text', e.target.value)} />
                      {(draft.content?.options?.length || 0) > 2 && <button className="option-remove" onClick={() => removeOption(i)}>×</button>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Word Cloud settings */}
            {draft.type === 'wordcloud' && (
              <div className="editor-field">
                <label className="editor-label">Words per Student</label>
                <div className="time-selector">
                  {[1,2,3,5].map(n => (
                    <button key={n} className={`time-btn ${draft.content?.maxWords === n ? 'active' : ''}`} onClick={() => updateMeta('maxWords', n)}>{n} word{n>1?'s':''}</button>
                  ))}
                </div>
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Students type words freely — they appear in a live word cloud on the host screen.</div>
              </div>
            )}

            {/* Q&A settings */}
            {draft.type === 'qa' && (
              <div className="editor-field">
                <label className="editor-label">Max Response Length</label>
                <div className="time-selector">
                  {[100,200,300,500].map(n => (
                    <button key={n} className={`time-btn ${draft.content?.maxResponseLength === n ? 'active' : ''}`} onClick={() => updateMeta('maxResponseLength', n)}>{n} chars</button>
                  ))}
                </div>
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Students type a free-text answer. Responses appear live on the host screen.</div>
              </div>
            )}

            {/* Settings */}
            <div className="editor-settings">
              <div className="editor-setting-item">
                <label className="editor-label">Time Limit</label>
                <div className="time-selector">
                  {[15, 20, 30, 45, 60, 90].map(t => (
                    <button
                      key={t}
                      className={`time-btn ${draft.content?.timeLimit === t ? 'active' : ''}`}
                      onClick={() => updateMeta('timeLimit', t)}
                    >
                      {t}s
                    </button>
                  ))}
                </div>
              </div>

              {draft.type === 'quiz' && (
                <div className="editor-setting-item">
                  <label className="editor-label">Points</label>
                  <div className="time-selector">
                    {[50, 100, 150, 200].map(p => (
                      <button
                        key={p}
                        className={`time-btn ${draft.content?.points === p ? 'active' : ''}`}
                        onClick={() => updateMeta('points', p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Preview */}
            <div className="editor-preview">
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: 'var(--muted)', marginBottom: 16, textTransform: 'uppercase' }}>Preview</div>
              <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>{draft.type}</div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>
                {draft.content?.question || 'Your question will appear here...'}
              </div>
              {(draft.type === 'quiz' || draft.type === 'poll') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {draft.content?.options?.map(opt => (
                    <div key={opt.id} style={{ padding: '12px 16px', borderRadius: 10, background: opt.isCorrect ? 'rgba(0,255,136,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${opt.isCorrect ? 'var(--green)' : 'rgba(255,255,255,0.08)'}`, color: opt.isCorrect ? 'var(--green)' : 'var(--text)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ opacity: 0.5, fontSize: 12 }}>{opt.id.toUpperCase()}</span>
                      {opt.text || <span style={{ opacity: 0.3 }}>Empty option</span>}
                      {opt.isCorrect && <span style={{ marginLeft: 'auto', fontSize: 12 }}>✓</span>}
                    </div>
                  ))}
                </div>
              )}
              {draft.type === 'wordcloud' && (
                <div style={{ padding: '16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                  ☁ Students type up to {draft.content?.maxWords || 3} word{draft.content?.maxWords > 1 ? 's' : ''} — displayed as a live word cloud
                </div>
              )}
              {draft.type === 'qa' && (
                <div style={{ padding: '16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--muted)', fontSize: 13 }}>
                  💬 Students type a free-text answer (max {draft.content?.maxResponseLength || 200} chars)
                </div>
              )}
              <div style={{ marginTop: 14, display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)' }}>
                <span>⏱ {draft.content?.timeLimit || 30}s</span>
                {draft.type === 'quiz' && <span>⭐ {draft.content?.points || 100} pts</span>}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* AI Generate Modal */}
      {showAI && (
        <div className="modal-overlay" onClick={() => { if (!aiLoading) setShowAI(false); }}>
          <div className="modal ai-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ fontSize: 28 }}>✨</div>
              <div>
                <div className="modal-title" style={{ marginBottom: 2 }}>AI Question Generator</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Describe a topic and Claude will generate quiz questions instantly</div>
              </div>
            </div>

            {!aiPreview ? (
              <>
                {/* Input mode toggle */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <button className={`tab-btn ${aiInputMode === 'topic' ? 'active' : ''}`} onClick={() => setAiInputMode('topic')}>✏️ Topic</button>
                  <button className={`tab-btn ${aiInputMode === 'document' ? 'active' : ''}`} onClick={() => setAiInputMode('document')}>📄 Generate from Doc</button>
                  <button className={`tab-btn ${aiInputMode === 'import' ? 'active' : ''}`} onClick={() => setAiInputMode('import')}>📥 Import Questions</button>
                </div>

                {aiInputMode === 'topic' ? (
                  <div className="editor-field">
                    <label className="editor-label">Topic or Subject</label>
                    <input
                      className="editor-input"
                      placeholder="e.g. World War II, Photosynthesis, Python loops..."
                      value={aiTopic}
                      onChange={e => setAiTopic(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !aiLoading && generateQuestions()}
                      autoFocus
                      disabled={aiLoading}
                    />
                  </div>
                ) : (
                  <div className="editor-field">
                    <label className="editor-label">Upload Document</label>
                    <input ref={aiFileRef} type="file" accept=".pdf,.txt,.md,.doc,.docx" style={{ display: 'none' }} onChange={handleAiFileChange} />
                    {!aiFile ? (
                      <div className="image-dropzone" onClick={() => aiFileRef.current?.click()}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Click to upload document</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>PDF, TXT, MD — max 5MB</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 10 }}>
                        <span style={{ fontSize: 24 }}>📄</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{aiFile.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{(aiFile.size / 1024).toFixed(1)} KB</div>
                        </div>
                        <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => { setAiFile(null); setAiFileText(''); }}>✕</button>
                      </div>
                    )}
                  </div>
                )}

                {aiInputMode !== 'import' && (<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>
                  <div>
                    <label className="editor-label">Questions</label>
                    <div className="time-selector">
                      {[3, 5, 8, 10].map(n => (
                        <button key={n} className={`time-btn ${aiCount === n ? 'active' : ''}`} onClick={() => setAiCount(n)}>{n}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="editor-label">Difficulty</label>
                    <div className="time-selector">
                      {['easy','medium','hard'].map(d => (
                        <button key={d} className={`time-btn ${aiDifficulty === d ? 'active' : ''}`} onClick={() => setAiDifficulty(d)} style={{ textTransform: 'capitalize' }}>{d}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="editor-label">Type</label>
                    <div className="time-selector">
                      <button className={`time-btn ${aiType === 'quiz' ? 'active' : ''}`} onClick={() => setAiType('quiz')}>Quiz</button>
                      <button className={`time-btn ${aiType === 'trivia' ? 'active' : ''}`} onClick={() => setAiType('trivia')}>Trivia</button>
                    </div>
                  </div>
                </div>)}

                {aiError && <div className="error-msg" style={{ marginBottom: 16 }}>{aiError}</div>}

                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setShowAI(false)} disabled={aiLoading}>Cancel</button>
                  <button className="btn btn-primary" onClick={generateQuestions} disabled={(aiInputMode === 'topic' ? !aiTopic.trim() : !aiFile) || aiLoading}
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', borderColor: 'transparent', minWidth: 160 }}>
                    {aiLoading ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                        <span className="spinner" style={{ width: 14, height: 14 }} /> Generating...
                      </span>
                    ) : aiInputMode === 'import' ? '📥 Import Questions' : `✨ Generate ${aiCount} Questions`}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
                  ✨ Generated <strong style={{ color: 'var(--text)' }}>{aiPreview.length} questions</strong> about "<strong style={{ color: '#a78bfa' }}>{aiTopic}</strong>" — review and add to your presentation:
                </div>

                <div className="ai-preview-list">
                  {aiPreview.map((q, i) => (
                    <div key={i} className="ai-preview-item">
                      <div className="ai-preview-q">
                        <span style={{ color: '#a78bfa', fontWeight: 800, marginRight: 8 }}>Q{i+1}</span>
                        {q.question}
                      </div>
                      <div className="ai-preview-options">
                        {q.options.map(o => (
                          <span key={o.id} className={`ai-preview-opt ${o.isCorrect ? 'correct' : ''}`}>
                            {o.isCorrect && '✓ '}{o.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="btn btn-ghost" onClick={() => setAiPreview(null)} disabled={aiLoading}>← Regenerate</button>
                  <button className="btn btn-primary" onClick={saveAIQuestions} disabled={aiLoading}
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', borderColor: 'transparent' }}>
                    {aiLoading ? 'Adding...' : `Add ${aiPreview.length} Slides →`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Theme Panel */}
      {showTheme && (
        <div className="modal-overlay" onClick={() => setShowTheme(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-title">🎨 Presentation Theme</div>

            <div className="editor-label" style={{ marginBottom: 10 }}>Preset Themes</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
              {PRESETS.map(p => (
                <div key={p.key} onClick={() => applyPreset(p)} style={{
                  borderRadius: 10, padding: '10px 8px', cursor: 'pointer', textAlign: 'center',
                  background: p.bg, border: `2px solid ${theme?.preset === p.key ? p.primary : 'transparent'}`,
                  transition: 'all 0.15s',
                }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: p.primary, margin: '0 auto 6px' }} />
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', opacity: 0.9 }}>{p.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <div className="editor-label" style={{ marginBottom: 6 }}>Accent Color</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={theme?.primaryColor || '#6366F1'}
                    onChange={e => setTheme(t => ({ ...t, primaryColor: e.target.value, preset: 'custom' }))}
                    style={{ width: 40, height: 36, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'none', padding: 0 }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'monospace' }}>{theme?.primaryColor}</span>
                </div>
              </div>
              <div>
                <div className="editor-label" style={{ marginBottom: 6 }}>Background</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={theme?.backgroundColor || '#0F172A'}
                    onChange={e => setTheme(t => ({ ...t, backgroundColor: e.target.value, preset: 'custom' }))}
                    style={{ width: 40, height: 36, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'none', padding: 0 }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'monospace' }}>{theme?.backgroundColor}</span>
                </div>
              </div>
            </div>

            <div className="editor-label" style={{ marginBottom: 8 }}>Font Family</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {FONTS.map(f => (
                <button key={f} onClick={() => setTheme(t => ({ ...t, fontFamily: f }))}
                  className={`time-btn ${theme?.fontFamily === f ? 'active' : ''}`}
                  style={{ fontFamily: f }}>
                  {f}
                </button>
              ))}
            </div>

            {/* Preview swatch */}
            <div style={{ borderRadius: 12, padding: '20px', marginBottom: 20, background: theme?.backgroundColor || '#0F172A', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontFamily: theme?.fontFamily || 'DM Sans', fontSize: 18, fontWeight: 800, color: theme?.primaryColor || '#6366F1', marginBottom: 6 }}>
                Preview heading
              </div>
              <div style={{ fontFamily: theme?.fontFamily || 'DM Sans', fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                This is how your slides will look to students.
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                {['A', 'B', 'C', 'D'].map(l => (
                  <div key={l} style={{ flex: 1, padding: '8px 4px', borderRadius: 6, textAlign: 'center', fontSize: 12, fontWeight: 700, fontFamily: theme?.fontFamily, background: `${theme?.primaryColor}20`, border: `1px solid ${theme?.primaryColor}50`, color: theme?.primaryColor }}>
                    {l}
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowTheme(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { saveTheme(); setShowTheme(false); }} disabled={savingTheme}>
                {themeSaved ? '✓ Saved!' : 'Save Theme'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />

      {/* Image picker modal */}
      {imageMode && (
        <div className="modal-overlay" onClick={() => setImageMode(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-title">Add Image</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <button className={`tab-btn ${imageMode === 'url' ? 'active' : ''}`} onClick={() => setImageMode('url')}>🔗 URL</button>
              <button className={`tab-btn ${imageMode === 'upload' ? 'active' : ''}`} onClick={() => setImageMode('upload')}>📁 Upload</button>
            </div>

            {imageMode === 'url' && (
              <>
                <div className="field">
                  <label>Image URL</label>
                  <input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                    placeholder="https://example.com/image.jpg" autoFocus
                    onKeyDown={e => e.key === 'Enter' && applyImageUrl()}
                  />
                </div>
                {imageUrl && (
                  <img src={imageUrl} alt="Preview" style={{ width: '100%', borderRadius: 8, marginTop: 10, maxHeight: 200, objectFit: 'cover' }}
                    onError={e => e.target.style.display='none'} />
                )}
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setImageMode(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={applyImageUrl} disabled={!imageUrl.trim()}>Use Image</button>
                </div>
              </>
            )}

            {imageMode === 'upload' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
                <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20 }}>Select an image file (max 2MB)</div>
                <button className="btn btn-primary" style={{ width: 'auto', margin: '0 auto' }} onClick={() => fileInputRef.current?.click()}>
                  Choose File
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-title">Delete Slide?</div>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24 }}>
              This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteSlide(deleteConfirm.id, deleteConfirm.idx)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
