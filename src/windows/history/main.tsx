import '../common/ui.css';
import './history.css';
import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { HistoryEntry, ItemAction } from '../../shared/ipc';
import { Icon, type IconName } from '../common/icons';
import { applyTheme } from '../common/theme';

const api = window.anyshot;
type Filter = 'all' | 'image' | 'video';

function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString();
}

function App() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(async () => setEntries(await api.invoke('history:list')), []);
  useEffect(() => {
    void api.invoke('settings:get').then(applyTheme);
    void reload();
  }, [reload]);

  const shown = entries.filter(
    (e) => filter === 'all' || (filter === 'image' ? e.kind === 'image' : e.kind !== 'image'),
  );

  const run = useCallback(
    async (entry: HistoryEntry | undefined, action: ItemAction) => {
      if (!entry) return;
      const result = await api.invoke('item:action', { historyId: entry.id, action });
      if (!result.ok && result.error !== 'cancelled') setStatus(result.error ?? 'Failed');
      else if (action === 'copy') setStatus('Copied to the clipboard');
      else if (action === 'save' || action === 'saveAs')
        setStatus(result.path ? `Saved to ${result.path}` : null);
      if (action === 'delete') await reload();
    },
    [reload],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const current = shown[selected];
      if (e.key === 'Escape') void api.invoke('window:close');
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
        setSelected((i) => Math.min(shown.length - 1, i + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setSelected((i) => Math.max(0, i - 1));
      else if (e.key === 'Enter') void run(current, 'copy');
      else if (e.key === 'Delete') void run(current, 'delete');
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') void run(current, 'edit');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, selected, run]);

  const action = (entry: HistoryEntry, icon: IconName, label: string, a: ItemAction) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        void run(entry, a);
      }}
    >
      <Icon name={icon} size={15} />
    </button>
  );

  return (
    <div class="history">
      <header>
        <h1>History</h1>
        <span class="count">{`${shown.length} capture${shown.length === 1 ? '' : 's'}`}</span>
        <div class="opt seg">
          {(['all', 'image', 'video'] as Filter[]).map((f) => (
            <button
              type="button"
              key={f}
              class={f === filter ? 'active' : ''}
              aria-pressed={f === filter}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'image' ? 'Screenshots' : 'Recordings'}
            </button>
          ))}
        </div>
        <button
          type="button"
          class="clear"
          disabled={entries.length === 0}
          onClick={async () => {
            if (
              !window.confirm(
                'Delete every capture in history? Files you saved elsewhere are kept.',
              )
            )
              return;
            await api.invoke('history:clear');
            await reload();
          }}
        >
          <Icon name="trash" size={15} /> Clear
        </button>
      </header>
      {shown.length === 0 ? (
        <p class="empty">No captures yet. Use the tray icon or your capture shortcut.</p>
      ) : (
        <ul class="grid">
          {shown.map((entry, i) => (
            <li key={entry.id}>
              <div
                class={`card${i === selected ? ' selected' : ''}`}
                data-testid="history-card"
                title="Click to select · Double-click or Enter to copy"
                onClick={() => setSelected(i)}
                onDblClick={() => void run(entry, 'copy')}
              >
                <img src={`/@history/${entry.id}/thumb`} alt="" loading="lazy" decoding="async" />
                <span class="meta">
                  {`${entry.width} × ${entry.height}`} · {timeAgo(entry.createdAt)}
                </span>
                <span class="actions">
                  {action(entry, 'copy', 'Copy', 'copy')}
                  {action(entry, 'editor', 'Open in editor', 'edit')}
                  {action(entry, 'pin', 'Pin to screen', 'pin')}
                  {action(entry, 'save', 'Save as…', 'saveAs')}
                  {action(entry, 'trash', 'Delete', 'delete')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {status && (
        <button type="button" class="toast" onClick={() => setStatus(null)}>
          {status}
        </button>
      )}
    </div>
  );
}

render(<App />, document.getElementById('root') as HTMLElement);
