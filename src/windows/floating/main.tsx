import '../common/ui.css';
import './floating.css';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FloatingItem, ItemAction } from '../../shared/ipc';
import { Icon, type IconName } from '../common/icons';
import { applyTheme } from '../common/theme';

const api = window.anyshot;

function Card({
  item,
  dismissSeconds,
  hovered,
}: {
  item: FloatingItem;
  dismissSeconds: number;
  hovered: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const remaining = useRef(dismissSeconds * 1000);
  // Auto-dismiss counts down only while the pointer is away from the previews.
  useEffect(() => {
    if (dismissSeconds === 0 || hovered) return;
    const started = performance.now();
    const timer = setTimeout(() => void api.invoke('floating:dismiss', item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - started;
    };
  }, [hovered, dismissSeconds, item.id]);

  const run = async (action: ItemAction, close: boolean) => {
    const result = await api.invoke('item:action', { historyId: item.historyId, action });
    if (!result.ok) {
      if (result.error !== 'cancelled') setStatus(result.error ?? 'Failed');
      return;
    }
    if (close) void api.invoke('floating:dismiss', item.id);
    else setStatus(action === 'copy' ? 'Copied' : 'Saved');
  };
  const corner = (icon: IconName, label: string, cls: string, action: () => void) => (
    <button
      type="button"
      class={`corner ${cls}`}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        action();
      }}
    >
      <Icon name={icon} size={15} />
    </button>
  );
  return (
    <div
      class="card"
      data-testid="floating-card"
      draggable
      onDragStart={(e) => {
        e.preventDefault();
        void api.invoke('item:action', { historyId: item.historyId, action: 'drag' });
      }}
      onClick={() => void api.invoke('floating:dismiss', item.id)}
    >
      <img src={`/@history/${item.historyId}/thumb`} alt="Capture preview" draggable={false} />
      <div class="hover">
        {corner('close', 'Close', 'tl', () => void api.invoke('floating:dismiss', item.id))}
        {corner('pin', 'Pin to screen', 'tr', () => void run('pin', true))}
        {corner('editor', 'Open in editor', 'bl', () => void run('edit', true))}
        <div class="center">
          <button
            type="button"
            data-testid="floating-copy"
            onClick={(e) => {
              e.stopPropagation();
              void run('copy', false);
            }}
          >
            Copy
          </button>
          <button
            type="button"
            data-testid="floating-save"
            onClick={(e) => {
              e.stopPropagation();
              void run('save', false);
            }}
          >
            Save
          </button>
        </div>
      </div>
      <span class="size">{`${item.width} × ${item.height}`}</span>
      {status && <span class="status">{status}</span>}
    </div>
  );
}

function App() {
  const [items, setItems] = useState<FloatingItem[]>([]);
  const [dismissSeconds, setDismissSeconds] = useState(5);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    void api.invoke('settings:get').then(applyTheme);
    void api.invoke('floating:ready').then((init) => {
      setItems(init.items);
      setDismissSeconds(init.dismissSeconds);
    });
    return api.on('floating:items', setItems);
  }, []);
  return (
    <div class="stack" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {items.map((item) => (
        <Card key={item.id} item={item} dismissSeconds={dismissSeconds} hovered={hovered} />
      ))}
    </div>
  );
}

render(<App />, document.getElementById('root') as HTMLElement);
