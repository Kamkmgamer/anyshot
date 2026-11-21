/** anyshot's own line icons (src/windows/common/icons.tsx): 20 × 20 grid, round joins. */
const icon = (paths: string) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  arrow: icon('<path d="M4 16L15 5"/><path d="M8.5 4.5H15.5V11.5"/>'),
  rect: icon('<rect x="3.5" y="5" width="13" height="10" rx="1.5"/>'),
  pen: icon('<path d="M4 16l1-4 8.5-8.5 3 3L8 15z"/><path d="M11.5 5.5l3 3"/>'),
  text: icon('<path d="M5 5h10M10 5v11"/><path d="M8 16h4"/>'),
  badge: icon('<circle cx="10" cy="10" r="7"/><path d="M9 7.5l1.6-1V14"/>'),
  censor: icon(
    '<rect x="3.5" y="3.5" width="13" height="13" rx="1.5"/><path d="M3.5 8h13M3.5 12h13M8 3.5v13M12 3.5v13" opacity=".7"/>',
  ),
  undo: icon('<path d="M7.5 5L4 8.5 7.5 12M4.5 8.5H12a4 4 0 010 8H9"/>'),
  close: icon('<path d="M5 5l10 10M15 5L5 15"/>'),
  copy: icon(
    '<rect x="6.5" y="6.5" width="10" height="10" rx="1.5"/><path d="M13.5 6.5V4.5a1 1 0 00-1-1h-8a1 1 0 00-1 1v8a1 1 0 001 1h2"/>',
  ),
  save: icon('<path d="M10 3.5v9M6.5 9.5L10 13l3.5-3.5"/><path d="M4 14.5v2h12v-2"/>'),
  pin: icon('<path d="M8 3.5h4l-.5 5 3 2.5H5.5l3-2.5z"/><path d="M10 11v5.5"/>'),
  mic: icon(
    '<rect x="7.5" y="3" width="5" height="9" rx="2.5"/><path d="M5 10a5 5 0 0010 0M10 15v2.5"/>',
  ),
  check: icon('<path d="M5 10.5l3 3 7-7"/>'),
  download: icon('<path d="M10 3.5v9M6.5 9.5L10 13l3.5-3.5"/><path d="M4 14.5v2h12v-2"/>'),
  copySmall: icon(
    '<rect x="6.5" y="6.5" width="10" height="10" rx="2"/><path d="M13.5 6.5V4.5a1 1 0 00-1-1h-8a1 1 0 00-1 1v8a1 1 0 001 1h2"/>',
  ),
  minimize: icon('<path d="M4 10h12"/>'),
  maximize: icon('<rect x="4" y="4" width="12" height="12" rx="1"/>'),
  files: icon('<path d="M5 3h6l4 4v10H5z"/><path d="M11 3v4h4"/>'),
  search: icon('<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>'),
  branch: icon(
    '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="15" r="2"/><circle cx="14" cy="8" r="2"/><path d="M6 7v6M14 10c0 3-8 2-8 3"/>',
  ),
  run: icon('<path d="M6 4l10 6-10 6z"/>'),
  extensions: icon(
    '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>',
  ),
  terminal: icon(
    '<rect x="3" y="4" width="14" height="11" rx="2"/><path d="M6.5 8l2 1.5-2 1.5M10.5 11.5h3"/>',
  ),
} as const;

export const WINDOWS_LOGO =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1 2.5l5.7-.8v5.6H1zM7.6 1.6L15 .5v6.8H7.6zM1 8.2h5.7v5.6L1 13zM7.6 8.2H15V15l-7.4-1z"/></svg>';

/** The default filename template, anyshot {date} at {time} (src/shared/filename.ts). */
export function captureName(ext: string, recording = false): string {
  const n = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  const date = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
  const time = `${p(n.getHours())}.${p(n.getMinutes())}.${p(n.getSeconds())}`;
  return `anyshot ${recording ? 'recording ' : ''}${date} at ${time}.${ext}`;
}

/** The element matching `selector` inside `root`; a missing one is a bug in the markup. */
export function must<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}
