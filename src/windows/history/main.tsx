import '../common/ui.css';
import './history.css';
import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { HistoryEntry, ItemAction } from '../../shared/ipc';
import { Icon, type IconName } from '../common/icons';
import { followTheme } from '../common/theme';

const api = window.anyshot;

/**
 * An entry's image or thumbnail. Edits replace the files but keep the id, so
 * the URL carries a version: otherwise the window keeps the old pixels it loaded.
 */
const mediaUrl = (entry: HistoryEntry, what: 'image' | 'thumb') =>
  `/@history/${entry.id}/${what}?v=${entry.updatedAt ?? entry.createdAt}`;
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

const isButton = (target: EventTarget | null) =>
  target instanceof Element && target.closest('button') !== null;

/**
 * Quick look inside the History window: the full image (loaded only while it
 * is shown), its size and time, and the entry's actions. Esc, Space or a
 * click outside closes it; ←/→ move between entries; double-click edits.
 */
function Preview(props: {
  entry: HistoryEntry;
  index: number;
  count: number;
  onClose: () => void;
  onMove: (delta: number) => void;
  run: (action: ItemAction) => void;
}) {
  const { entry } = props;
  const dialog = useRef<HTMLDivElement>(null);
  // Layout effects: focus and the Tab trap are in place before the first key after opening.
  useLayoutEffect(() => {
    // Focus moves into the dialog so keys and screen readers follow it.
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, [entry.id]);
  useLayoutEffect(() => {
    // Tab cycles through the dialog's controls. Handled for the whole window,
    // so focus that fell to <body> (e.g. a button that became disabled) comes back.
    const onTab = (e: KeyboardEvent) => {
      const root = dialog.current;
      if (e.key !== 'Tab' || !root) return;
      const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled)')];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      const i = controls.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      if (e.shiftKey) (i <= 0 ? last : controls[i - 1])?.focus();
      else (i === -1 || i === controls.length - 1 ? first : controls[i + 1])?.focus();
    };
    window.addEventListener('keydown', onTab, true);
    return () => window.removeEventListener('keydown', onTab, true);
  }, []);
  const action = (icon: IconName, label: string, a: ItemAction) => (
    <button type="button" data-testid={`preview-${a}`} onClick={() => props.run(a)}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );
  return (
    <div
      class="preview-backdrop"
      data-testid="preview"
      onClick={(e) => {
        // The second click of a double-click belongs to the double-click (edit).
        if (e.target === e.currentTarget && e.detail < 2) props.onClose();
      }}
      onDblClick={(e) => {
        if (!isButton(e.target)) props.run('edit');
      }}
    >
      <div
        ref={dialog}
        class="preview"
        role="dialog"
        aria-modal="true"
        aria-label={`Capture ${props.index + 1} of ${props.count}`}
        tabIndex={-1}
      >
        <div class="preview-image">
          <button
            type="button"
            class="nav prev"
            aria-label="Previous capture (←)"
            title="Previous (←)"
            disabled={props.index === 0}
            onClick={() => props.onMove(-1)}
          >
            <Icon name="chevronDown" size={18} />
          </button>
          <img
            key={entry.id}
            src={mediaUrl(entry, 'image')}
            alt={`Capture from ${new Date(entry.createdAt).toLocaleString()}`}
            decoding="async"
            data-testid="preview-image"
          />
          <button
            type="button"
            class="nav next"
            aria-label="Next capture (→)"
            title="Next (→)"
            disabled={props.index >= props.count - 1}
            onClick={() => props.onMove(1)}
          >
            <Icon name="chevronDown" size={18} />
          </button>
        </div>
        <div class="preview-bar">
          <span class="preview-meta" data-testid="preview-meta">
            <strong>{`${entry.width} × ${entry.height}`}</strong>
            <span>
              {new Date(entry.createdAt).toLocaleString()} · {timeAgo(entry.createdAt)}
            </span>
          </span>
          <span class="preview-count">{`${props.index + 1} / ${props.count}`}</span>
          <span class="preview-actions">
            {action('copy', 'Copy', 'copy')}
            {action('editor', 'Edit', 'edit')}
            {action('pin', 'Pin', 'pin')}
            {action('save', 'Save as…', 'saveAs')}
            {action('trash', 'Delete', 'delete')}
          </span>
          <button
            type="button"
            class="preview-close"
            aria-label="Close preview (Esc)"
            title="Close (Esc)"
            data-testid="preview-close"
            onClick={props.onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [selection, setSelected] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(async () => setEntries(await api.invoke('history:list')), []);
  useEffect(() => {
    followTheme();
    void reload();
    return api.on('history:changed', () => void reload());
  }, [reload]);

  const shown = entries.filter(
    (e) => filter === 'all' || (filter === 'image' ? e.kind === 'image' : e.kind !== 'image'),
  );

  const lastIndex = Math.max(0, shown.length - 1);
  const selected = Math.min(selection, lastIndex);
  useEffect(() => {
    if (selection !== selected) setSelected(selected);
  }, [selection, selected]);
  const previewed = previewing ? shown[selected] : undefined;
  useEffect(() => {
    // Deleting the last entry (or clearing history) ends the preview.
    if (previewing && shown.length === 0) setPreviewing(false);
  }, [previewing, shown.length]);
  const closePreview = useCallback(() => {
    setPreviewing(false);
    // Back to the card that was previewed, for keyboard users.
    requestAnimationFrame(() =>
      document.querySelectorAll<HTMLElement>('[data-testid="history-card"]')[selected]?.focus(),
    );
  }, [selected]);

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

  // A layout effect: the listener must see the new state as soon as it commits,
  // or a key pressed right after closing the preview acts on the old state.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const current = shown[selected];
      const mod = e.ctrlKey || e.metaKey;
      // Keys on a focused button (e.g. Enter, Space) activate it instead.
      if (isButton(e.target) && (e.key === 'Enter' || e.key === ' ')) return;
      if (e.key === 'Escape') {
        if (previewing) closePreview();
        else void api.invoke('window:close');
      } else if (e.key === ' ') {
        if (previewing) closePreview();
        else if (current) setPreviewing(true);
      } else if (e.key === 'ArrowRight' || (!previewing && e.key === 'ArrowDown'))
        setSelected((i) => Math.min(lastIndex, i + 1));
      else if (e.key === 'ArrowLeft' || (!previewing && e.key === 'ArrowUp'))
        setSelected((i) => Math.max(0, i - 1));
      else if (e.key === 'Enter' || (mod && e.key.toLowerCase() === 'c')) void run(current, 'copy');
      else if (e.key === 'Delete') void run(current, 'delete');
      else if (mod && e.key.toLowerCase() === 'e') void run(current, 'edit');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, selected, lastIndex, run, previewing, closePreview]);

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
      {/* Behind an open preview: no focus, clicks or screen-reader access. */}
      <header inert={previewing}>
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
        <ul class="grid" inert={previewing}>
          {shown.map((entry, i) => (
            <li key={entry.id}>
              <div
                class={`card${i === selected ? ' selected' : ''}`}
                data-testid="history-card"
                title="Click to preview · Double-click to edit · Enter copies"
                tabIndex={i === selected ? 0 : -1}
                onClick={() => {
                  setSelected(i);
                  setPreviewing(true);
                }}
                onDblClick={() => {
                  setPreviewing(false);
                  void run(entry, 'edit');
                }}
              >
                <img src={mediaUrl(entry, 'thumb')} alt="" loading="lazy" decoding="async" />
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
      {previewed && (
        <Preview
          entry={previewed}
          index={selected}
          count={shown.length}
          onClose={closePreview}
          onMove={(delta) => setSelected((i) => Math.max(0, Math.min(lastIndex, i + delta)))}
          run={(a) => {
            if (a === 'edit') setPreviewing(false);
            void run(previewed, a);
          }}
        />
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
