import '../common/ui.css';
import './pin.css';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PinInit } from '../../shared/ipc';
import { Icon } from '../common/icons';
import { applyTheme } from '../common/theme';

const api = window.anyshot;

function App({ init }: { init: PinInit }) {
  const base = useRef({ width: window.innerWidth, height: window.innerHeight });
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void api.invoke('window:close');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c')
        void api.invoke('item:action', { historyId: init.historyId, action: 'copy' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [init.historyId]);

  const applyZoom = (next: number) => {
    const z = Math.min(5, Math.max(0.1, next));
    setZoom(z);
    void api.invoke('window:set-size', {
      width: base.current.width * z,
      height: base.current.height * z,
    });
  };

  return (
    <div
      class="pin"
      data-testid="pin"
      onWheel={(e) => applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
        drag.current = { x: e.screenX, y: e.screenY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.screenX - drag.current.x;
        const dy = e.screenY - drag.current.y;
        drag.current = { x: e.screenX, y: e.screenY };
        if (dx || dy) void api.invoke('pin:move-by', { dx, dy });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <img src={init.src} alt="Pinned capture" draggable={false} />
      <div class="controls">
        <button type="button" class="zoom" title="Reset zoom" onClick={() => applyZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          title="Copy"
          aria-label="Copy"
          onClick={() =>
            void api.invoke('item:action', { historyId: init.historyId, action: 'copy' })
          }
        >
          <Icon name="copy" size={15} />
        </button>
        <button
          type="button"
          title="Open in editor"
          aria-label="Open in editor"
          onClick={() =>
            void api.invoke('item:action', { historyId: init.historyId, action: 'edit' })
          }
        >
          <Icon name="editor" size={15} />
        </button>
        <button
          type="button"
          title="Close (Esc)"
          aria-label="Close"
          data-testid="pin-close"
          onClick={() => void api.invoke('window:close')}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
    </div>
  );
}

void api.invoke('pin:init').then((init) => {
  void api.invoke('settings:get').then(applyTheme);
  render(<App init={init} />, document.getElementById('root') as HTMLElement);
});
