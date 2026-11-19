import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../common/icons';
import { SAVE_MODE_LABELS, SAVE_MODES, type SaveMode, shortcutFor } from './save-mode';

const SHORT_LABELS: Record<SaveMode, string> = { replace: 'Replace', copy: 'Save copy' };

/**
 * Save for captures that have a history entry: the main part runs the
 * remembered choice, the chevron opens a menu with both choices and their
 * shortcuts. Arrow keys move in the menu, Enter picks, Esc or a click
 * elsewhere closes it.
 */
export function SaveSplitButton(props: {
  primary: SaveMode;
  disabled: boolean;
  onSave: (mode: SaveMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const outside = (e: PointerEvent) => {
      if (!(e.target instanceof Node && root.current?.contains(e.target))) setOpen(false);
    };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', blur);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const choose = (mode: SaveMode) => {
    close();
    props.onSave(mode);
  };
  const onMenuKey = (e: KeyboardEvent, i: number) => {
    const count = SAVE_MODES.length;
    const focus = (j: number) => items.current[(j + count) % count]?.focus();
    if (e.key === 'ArrowDown') focus(i + 1);
    else if (e.key === 'ArrowUp') focus(i - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(count - 1);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') setOpen(false);
    else return;
    // The editor's window shortcuts (nudging, Esc deselect) must not see these keys.
    e.stopPropagation();
    if (e.key !== 'Tab') e.preventDefault();
  };

  return (
    <div class="split" ref={root}>
      <button
        type="button"
        class="split-main"
        title={`${SAVE_MODE_LABELS[props.primary]} (Ctrl+S)`}
        disabled={props.disabled}
        data-testid="editor-save"
        onClick={() => props.onSave(props.primary)}
      >
        <Icon name="save" />
        <span>{SHORT_LABELS[props.primary]}</span>
      </button>
      <button
        ref={toggle}
        type="button"
        class="split-toggle"
        title="Save options"
        aria-label="Save options"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={props.disabled}
        data-testid="save-menu-toggle"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' || open) return;
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div role="menu" class="menu" aria-label="Save options" data-testid="save-menu">
          {SAVE_MODES.map((mode, i) => (
            <button
              key={mode}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={mode === props.primary}
              tabIndex={-1}
              data-testid={`save-${mode}`}
              onClick={() => choose(mode)}
              onKeyDown={(e) => onMenuKey(e, i)}
            >
              <span class="check">{mode === props.primary && <Icon name="check" size={14} />}</span>
              <span>{SAVE_MODE_LABELS[mode]}</span>
              <kbd>{shortcutFor(mode, props.primary)}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
