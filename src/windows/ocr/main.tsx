import '../common/ui.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { OcrResult } from '../../shared/ipc';
import { followTheme } from '../common/theme';

const api = window.anyshot;

function App({ result }: { result: OcrResult }) {
  const [text, setText] = useState(result.text);
  const [copied, setCopied] = useState(false);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const copy = async () => {
    await api.invoke('clipboard:text', text);
    setCopied(true);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void copy();
      if (e.key === 'Escape') void api.invoke('window:close');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: '1fr auto',
        height: '100vh',
        padding: '12px',
        gap: '10px',
        boxSizing: 'border-box',
        color: 'var(--bar-fg)',
      }}
    >
      <textarea
        data-testid="ocr-text"
        value={text}
        placeholder="No text was found in this capture."
        onInput={(e) => {
          setText((e.target as HTMLTextAreaElement).value);
          setCopied(false);
        }}
        style={{
          resize: 'none',
          font: '14px/1.5 system-ui, sans-serif',
          padding: '10px',
          borderRadius: '8px',
          border: '1px solid var(--field-border)',
          background: 'var(--field-bg)',
          color: 'inherit',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ color: 'var(--bar-muted)', flex: 1 }}>
          {`${text.length} characters · ${words} words · ${Math.round(result.confidence)}% confidence`}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          style={{
            padding: '7px 16px',
            border: 0,
            borderRadius: '8px',
            background: 'var(--accent)',
            color: '#fff',
            cursor: 'pointer',
            font: '600 13px system-ui',
          }}
        >
          {copied ? 'Copied' : 'Copy (Ctrl+Enter)'}
        </button>
      </div>
    </div>
  );
}

void api.invoke('ocr:init').then((result) => {
  followTheme();
  render(<App result={result} />, document.getElementById('root') as HTMLElement);
});
