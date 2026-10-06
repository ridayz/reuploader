import { useState } from 'react';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [url, setUrl] = useState('');
  const [moods, setMoods] = useState<string[]>(['lucu', 'marah']);
  const [output, setOutput] = useState<'short' | 'standard'>('standard');
  const [minScore, setMinScore] = useState(70);
  const [agentUrl, setAgentUrl] = useState(
    () => localStorage.getItem('reup_agent_url') || 'http://127.0.0.1:20128/v1'
  );
  const [agentKey, setAgentKey] = useState(
    () => localStorage.getItem('reup_agent_key') || ''
  );
  const [model, setModel] = useState('agnes/agnes-3.0-flash');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({ pct: 0, stage: '' });
  const [result, setResult] = useState<null | {
    file: string; title: string; caption: string; moments: number; minutes: number;
  }>(null);
  const [error, setError] = useState('');

  const toggleMood = (m: string) =>
    setMoods((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));

  const compile = async () => {
    if (!url.trim() || !agentKey.trim() || moods.length === 0 || busy) return;
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
            moments: pr.moments, minutes: pr.minutes,
          });
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
    navigator.clipboard.writeText(`${result.title}\n\n${result.caption}`);
  };

  return (
    <div className="wrap">
      <h1>🎬 Reuploader</h1>
      <div className="sub">Link panjang → kompilasi momen 10–15 menit. Siap upload.</div>

      <div className="card">
        <label>YouTube URL</label>
        <input type="text" placeholder="https://www.youtube.com/watch?v=..." value={url}
          onChange={(e) => setUrl(e.target.value)} />

        <label>Mood momen</label>
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

        <label>Ambang skor virality: {minScore}</label>
        <input type="range" min={40} max={95} value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))} style={{ width: '100%' }} />

        <label>Agent Base URL</label>
        <input type="text" value={agentUrl}
          onChange={(e) => { setAgentUrl(e.target.value); localStorage.setItem('reup_agent_url', e.target.value); }} />

        <label>Agent API Key</label>
        <input type="password" value={agentKey}
          onChange={(e) => { setAgentKey(e.target.value); localStorage.setItem('reup_agent_key', e.target.value); }} />

        <label>Model</label>
        <input type="text" value={model} onChange={(e) => setModel(e.target.value)} />

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
          <pre className="cap">{result.caption}</pre>
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
