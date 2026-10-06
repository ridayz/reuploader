import { useState } from 'react';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [url, setUrl] = useState('');
  const [moods, setMoods] = useState<string[]>(['lucu', 'marah']);
  const [output, setOutput] = useState<'short' | 'standard'>('standard');
  const [minScore, setMinScore] = useState(70);
  const [subs, setSubs] = useState(false);
  const [agentUrl, setAgentUrl] = useState(
    () => localStorage.getItem('reup_agent_url') || 'http://127.0.0.1:20128/v1'
  );
  const [agentKey, setAgentKey] = useState(
    () => localStorage.getItem('reup_agent_key') || ''
  );
  const [model, setModel] = useState('agnes/agnes-3.0-flash');
  const [busy, setBusy] = useState(false);
  const [capEdit, setCapEdit] = useState('');
  const [edLines, setEdLines] = useState<string[]>(['', '', '']);
  const [edY, setEdY] = useState(300);
  const [edSize, setEdSize] = useState(96);
  const [edThumb, setEdThumb] = useState('');
  const [edBusy, setEdBusy] = useState(false);
  const [prog, setProg] = useState({ pct: 0, stage: '' });
  const [result, setResult] = useState<null | {
    file: string; title: string; caption: string; moments: number; minutes: number; thumb?: string;
  }>(null);
  const [error, setError] = useState('');

  const toggleMood = (m: string) =>
    setMoods((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));

  const compile = async () => {
    if (!url.trim() || !agentKey.trim() || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    setProg({ pct: 0, stage: 'start' });
    try {
      const r = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          moods,
          min_score: minScore,
          output,
          subtitles: subs,
          oai_base_url: agentUrl.trim(),
          oai_api_key: agentKey.trim(),
          oai_model: model,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { job_id } = await r.json();
      for (let i = 0; i < 600; i++) {
        await sleep(3000);
        const pr = await (await fetch(`/api/compile-progress/${job_id}`)).json();
        setProg({ pct: pr.pct || 0, stage: pr.stage || '' });
        if (pr.done) {
          if (pr.error) throw new Error(pr.error);
          setResult({
            file: pr.file, title: pr.title, caption: pr.caption,
            moments: pr.moments, minutes: pr.minutes, thumb: pr.thumb,
          });
          setCapEdit(pr.caption || '');
          break;
        }
      }
    } catch (e) {
      setError(String(e).slice(0, 300));
    } finally {
      setBusy(false);
    }
  };

  const copyCaption = () => {
    if (!result) return;
    navigator.clipboard.writeText(`${result.title}\n\n${capEdit}`);
  };

  return (
    <div className="wrap">
      <h1>🎬 Reuploader</h1>
      <div className="sub">Link panjang → kompilasi momen 10–15 menit. Siap upload.</div>

      <div className="card">
        <label>YouTube URL</label>
        <input type="text" placeholder="https://www.youtube.com/watch?v=..." value={url}
          onChange={(e) => setUrl(e.target.value)} />

        <label>Mood momen <span style={{ fontWeight: 400, textTransform: 'none' }}>(opsional — kosongkan = semua momen)</span></label>
        <div className="moods">
          {['lucu', 'marah', 'sedih', 'kocak'].map((m) => (
            <div key={m} className={'mood' + (moods.includes(m) ? ' on' : '')}
              onClick={() => toggleMood(m)}>
              {m === 'lucu' ? '😂' : m === 'marah' ? '😡' : m === 'sedih' ? '😢' : '🤣'} {m}
            </div>
          ))}
        </div>

        <label>Format output</label>
        <div className="moods">
          <div className={'mood' + (output === 'short' ? ' on' : '')}
            onClick={() => setOutput('short')}>📱 Short (vertikal, ≤3 mnt)</div>
          <div className={'mood' + (output === 'standard' ? ' on' : '')}
            onClick={() => setOutput('standard')}>🖥️ Standar (landscape, 10–15 mnt)</div>
        </div>

        <label>Agent Base URL</label>
        <input type="text" value={agentUrl}
          onChange={(e) => { setAgentUrl(e.target.value); localStorage.setItem('reup_agent_url', e.target.value); }} />

        <label>Agent API Key</label>
        <input type="password" value={agentKey}
          onChange={(e) => { setAgentKey(e.target.value); localStorage.setItem('reup_agent_key', e.target.value); }} />

        <label>Model</label>
        <input type="text" value={model} onChange={(e) => setModel(e.target.value)} />

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.9rem', textTransform: 'none', fontSize: '0.9rem', color: 'var(--text)' }}>
          <input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)}
            style={{ width: '18px', height: '18px', accentColor: '#a855f7' }} />
          📝 Subtitle bakar (untuk penonton tuli)
        </label>

        <button className="btn" disabled={busy} onClick={compile}>
          {busy ? '⏳ Merakit...' : '🔥 Rakit Kompilasi'}
        </button>

        {(busy || prog.pct > 0) && (
          <div style={{ marginTop: '1rem' }}>
            <div className="meta"><span>{prog.stage}</span><span>{Math.round(prog.pct)}%</span></div>
            <div className="bar"><div style={{ width: `${prog.pct}%` }} /></div>
          </div>
        )}
        {error && <div style={{ color: '#f87171', marginTop: '0.75rem', fontSize: '0.85rem' }}>❌ {error}</div>}
      </div>

      {result && (
        <div className="card">
          <h3 style={{ margin: '0 0 0.25rem' }}>{result.title}</h3>
          <div className="sub">{result.moments} momen · {result.minutes} menit</div>
          <video controls src={`/api/compile-file/${result.file}`} />
          {result.thumb && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--muted)', marginBottom: '0.35rem' }}>
                🖼️ THUMBNAIL (klik buat download)
              </div>
              <a href={`/api/compile-file/${result.thumb}`} download style={{ display: 'inline-block' }}>
                <img src={`/api/compile-file/${result.thumb}`} alt="thumbnail"
                  style={{ width: '100%', maxWidth: '480px', borderRadius: '12px', border: '1px solid var(--border)' }} />
              </a>
            </div>
          )}
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '10px', border: '1px dashed var(--border)' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--muted)', marginBottom: '0.4rem' }}>
              🎨 EDIT THUMBNAIL MANUAL (font Black)
            </div>
            {[0, 1, 2].map((i) => (
              <input key={i} type="text" placeholder={`Baris ${i + 1}`} value={edLines[i] || ''}
                onChange={(e) => setEdLines((p) => { const n = [...p]; n[i] = e.target.value; return n; })}
                style={{ width: '100%', marginBottom: '0.3rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', padding: '0.5rem 0.7rem', fontSize: '0.85rem' }} />
            ))}
            <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Posisi Y: {edY}</label>
            <input type="range" min={40} max={1400} value={edY} onChange={(e) => setEdY(Number(e.target.value))} style={{ width: '100%' }} />
            <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Ukuran font: {edSize}</label>
            <input type="range" min={40} max={160} value={edSize} onChange={(e) => setEdSize(Number(e.target.value))} style={{ width: '100%' }} />
            <button className="chip-btn" disabled={edBusy} style={{ marginTop: '0.4rem' }}
              onClick={async () => {
                if (edBusy) return;
                setEdBusy(true);
                try {
                  const r = await fetch('/api/thumb-custom', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ video_file: result.file, lines: edLines, y_start: edY, fontsize: edSize }),
                  });
                  if (!r.ok) throw new Error(await r.text());
                  setEdThumb((await r.json()).thumb);
                } catch (e) {
                  alert('Gagal: ' + String(e).slice(0, 150));
                } finally {
                  setEdBusy(false);
                }
              }}>
              {edBusy ? '⏳ Bikin...' : '🖼️ Bikin thumbnail custom'}
            </button>
            {edThumb && (
              <a href={`/api/compile-file/${edThumb}`} download style={{ display: 'inline-block', marginTop: '0.5rem' }}>
                <img src={`/api/compile-file/${edThumb}`} alt="custom thumb"
                  style={{ width: '100%', maxWidth: '480px', borderRadius: '12px', border: '1px solid var(--border)' }} />
              </a>
            )}
          </div>
          <pre className="cap">{capEdit}</pre>
          <textarea value={capEdit} onChange={(e) => setCapEdit(e.target.value)} rows={3}
            placeholder="Ketik deskripsi manual di sini..."
            style={{ width: '100%', marginTop: '0.5rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', padding: '0.6rem 0.7rem', fontSize: '0.82rem', fontFamily: 'inherit' }} />
          <div className="row">
            <button className="chip-btn" onClick={() => navigator.clipboard.writeText(result.title)}>📋 Copy judul</button>
            <button className="chip-btn" onClick={() => navigator.clipboard.writeText(`${result.title}\n\n${capEdit}`)}>📋 Copy judul + deskripsi</button>
          </div>
          <div className="row">
            <a className="chip-btn" href={`/api/compile-file/${result.file}`} download
              style={{ textDecoration: 'none' }}>⬇️ Download MP4</a>
            <button className="chip-btn" onClick={copyCaption}>📋 Copy judul + caption</button>
            <button className="chip-btn"
              onClick={() => window.open('https://www.youtube.com/upload', '_blank')}>▶️ Buka Upload YouTube</button>
          </div>
        </div>
      )}
    </div>
  );
}
