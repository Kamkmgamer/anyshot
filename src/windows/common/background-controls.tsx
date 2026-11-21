import './backgrounds.css';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BACKGROUNDS } from '../../engine/background-render';
import {
  type Background,
  type CustomBackground,
  DEFAULT_GRADIENT,
  type SavedBackground,
} from '../../shared/background';
import { BackgroundCanvas, BackgroundDesigner } from './background-designer';
import { importBackground } from './background-import';

type Draft = Omit<SavedBackground, 'id'> & { id?: string };
const api = window.anyshot;

function matches(a: Background | null, b: CustomBackground): boolean {
  if (typeof a !== 'object' || !a || a.kind !== b.kind) return false;
  if (a.kind === 'image' && b.kind === 'image') {
    return (
      a.data === b.data && a.fit === b.fit && a.x === b.x && a.y === b.y && a.matte === b.matte
    );
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export function BackgroundControls({
  value,
  onSelect,
  onClear,
  children,
}: {
  value: Background | null;
  onSelect: (background: Background) => void;
  onClear?: () => void;
  children?: ComponentChildren;
}) {
  const [entries, setEntries] = useState<SavedBackground[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api
        .invoke('backgrounds:list')
        .then((list) => {
          if (active) setEntries(list);
        })
        .catch(() => {
          if (active) setError('Could not load saved backgrounds.');
        });
    };
    const off = api.on('backgrounds:changed', refresh);
    refresh();
    return () => {
      active = false;
      off();
    };
  }, []);

  const open = (value: Draft | null) => {
    setDraft(value);
    setError('');
    setConfirmRemove(false);
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  const edit = (background: CustomBackground, entry?: SavedBackground) =>
    open({
      ...(entry ? { id: entry.id } : {}),
      name: entry?.name ?? (background.kind === 'gradient' ? 'Custom gradient' : 'Custom image'),
      background,
    });
  const activeEntry = entries.find(({ background }) => matches(value, background));
  const currentCustom = value !== null && typeof value !== 'number' ? value : null;

  return (
    <div
      class="background-controls"
      onKeyDown={(e) => {
        const key = e.key.toLowerCase();
        const exportShortcut = !draft && (e.ctrlKey || e.metaKey) && (key === 'c' || key === 's');
        if (key !== 'escape' && !exportShortcut) e.stopPropagation();
      }}
    >
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp"
        aria-label="Background image"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          void run(async () =>
            open({
              name: file.name.replace(/\.[^.]+$/, '').slice(0, 60),
              background: await importBackground(file),
            }),
          );
        }}
      />
      {draft ? (
        <>
          <div class="bg-editor-head">
            <strong>
              {draft.background.kind === 'gradient' ? 'Gradient designer' : 'Image background'}
            </strong>
            <button class="bg-button" type="button" disabled={busy} onClick={() => open(null)}>
              Back
            </button>
          </div>
          <fieldset class="bg-editor" disabled={busy}>
            <BackgroundDesigner
              value={draft.background}
              onChange={(background) => setDraft({ ...draft, background })}
            />
            <div class="bg-editor-foot">
              <label class="bg-field">
                <span>Background name</span>
                <input
                  type="text"
                  value={draft.name}
                  maxLength={60}
                  onInput={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
                />
              </label>
              <button
                class="bg-button primary"
                type="button"
                disabled={!draft.name.trim()}
                onClick={() =>
                  void run(async () => {
                    const saved = await api.invoke('backgrounds:save', draft);
                    onSelect(saved.background);
                    open(null);
                  })
                }
              >
                Save background
              </button>
            </div>
            {draft.id && (
              <div class="bg-actions">
                {confirmRemove && <span>Remove this saved background?</span>}
                <button
                  class="bg-button"
                  type="button"
                  onClick={() => {
                    if (!confirmRemove) {
                      setConfirmRemove(true);
                      return;
                    }
                    const id = draft.id;
                    if (id)
                      void run(async () => {
                        await api.invoke('backgrounds:remove', id);
                        open(null);
                      });
                  }}
                >
                  {confirmRemove ? 'Remove background' : 'Delete from library'}
                </button>
                {confirmRemove && (
                  <button class="bg-button" type="button" onClick={() => setConfirmRemove(false)}>
                    Keep
                  </button>
                )}
              </div>
            )}
          </fieldset>
        </>
      ) : (
        <>
          <fieldset class={`gradients${onClear ? '' : ' without-none'}`} aria-label="Background">
            {onClear && (
              <button
                type="button"
                class={`none${value === null ? ' active' : ''}`}
                title="No background"
                aria-label="No background"
                aria-pressed={value === null}
                data-testid="beautify-none"
                onClick={onClear}
              />
            )}
            {BACKGROUNDS.map(([from, to], index) => (
              <button
                type="button"
                key={from}
                class={value === index ? 'active' : ''}
                title={`Background ${index + 1}`}
                aria-label={`Background ${index + 1}`}
                aria-pressed={value === index}
                style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                onClick={() => onSelect(index)}
              />
            ))}
          </fieldset>
          {(entries.length > 0 || currentCustom) && (
            <fieldset class="bg-library" aria-label="Custom backgrounds">
              <div class="bg-library-items">
                {entries.map((entry) => (
                  <div class="bg-saved" key={entry.id}>
                    <button
                      type="button"
                      class="bg-tile"
                      aria-pressed={activeEntry?.id === entry.id}
                      title={entry.name}
                      onClick={() => onSelect(entry.background)}
                    >
                      <BackgroundCanvas background={entry.background} />
                      <span>{entry.name}</span>
                    </button>
                    <button
                      class="bg-button bg-edit"
                      type="button"
                      aria-label={`Edit ${entry.name}`}
                      onClick={() => edit(entry.background, entry)}
                    >
                      Edit
                    </button>
                  </div>
                ))}
                {currentCustom && !activeEntry && (
                  <div class="bg-saved">
                    <button
                      type="button"
                      class="bg-tile"
                      aria-pressed="true"
                      onClick={() => edit(currentCustom)}
                    >
                      <BackgroundCanvas background={currentCustom} />
                      <span>Current background</span>
                    </button>
                    <button
                      class="bg-button bg-edit"
                      type="button"
                      onClick={() => edit(currentCustom)}
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            </fieldset>
          )}
          <div class="bg-actions">
            <button
              class="bg-button"
              type="button"
              disabled={busy}
              onClick={() => open({ name: 'Custom gradient', background: DEFAULT_GRADIENT })}
            >
              New gradient
            </button>
            <button
              class="bg-button"
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy ? 'Importing…' : 'Import image'}
            </button>
          </div>
          {children}
        </>
      )}
      {error && (
        <p class="bg-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
