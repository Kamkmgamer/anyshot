import type { JSX } from 'preact';

// anyshot's own line icons: 20×20 grid, 1.7 stroke, round joins.
const ICONS = {
  select: <path d="M5 3l10 6-4.2 1.2L13 15l-2 1-2.3-4.7L5 14z" />,
  pencil: (
    <>
      <path d="M4 16l1-4 8.5-8.5 3 3L8 15z" />
      <path d="M11.5 5.5l3 3" />
    </>
  ),
  line: <path d="M4 16L16 4" />,
  arrow: (
    <>
      <path d="M4 16L15 5" />
      <path d="M8.5 4.5H15.5V11.5" />
    </>
  ),
  rect: <rect x="3.5" y="5" width="13" height="10" rx="1.5" />,
  ellipse: <ellipse cx="10" cy="10" rx="7" ry="5.5" />,
  marker: (
    <>
      <path d="M6 13l6.5-9 3 2.2L9 15H6z" />
      <path d="M4 17h12" opacity="0.6" />
    </>
  ),
  text: (
    <>
      <path d="M5 5h10M10 5v11" />
      <path d="M8 16h4" />
    </>
  ),
  number: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M9 7.5l1.6-1V14" />
    </>
  ),
  censor: (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" />
      <path d="M3.5 8h13M3.5 12h13M8 3.5v13M12 3.5v13" opacity="0.7" />
    </>
  ),
  spotlight: (
    <>
      <circle cx="10" cy="10" r="4" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    </>
  ),
  magnify: (
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2L17 17M6.5 8.5h4M8.5 6.5v4" />
    </>
  ),
  stamp: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M7 11.5c1.5 2 4.5 2 6 0" />
      <path d="M7.5 8h.01M12.5 8h.01" strokeWidth="2.4" />
    </>
  ),
  picker: (
    <>
      <path d="M12 4.5l3.5 3.5M14.5 3l2.5 2.5-3 3-2.5-2.5z" />
      <path d="M12.5 7.5L5 15v2h2l7.5-7.5" />
    </>
  ),
  measure: (
    <>
      <path d="M3 13.5L13.5 3 17 6.5 6.5 17z" />
      <path d="M6 10.5l1.5 1.5M8.5 8l1 1M11 5.5l1.5 1.5" />
    </>
  ),
  undo: <path d="M7.5 5L4 8.5 7.5 12M4.5 8.5H12a4 4 0 010 8H9" />,
  redo: <path d="M12.5 5L16 8.5 12.5 12M15.5 8.5H8a4 4 0 000 8h3" />,
  copy: (
    <>
      <rect x="6.5" y="6.5" width="10" height="10" rx="1.5" />
      <path d="M13.5 6.5V4.5a1 1 0 00-1-1h-8a1 1 0 00-1 1v8a1 1 0 001 1h2" />
    </>
  ),
  save: (
    <>
      <path d="M10 3.5v9M6.5 9.5L10 13l3.5-3.5" />
      <path d="M4 14.5v2h12v-2" />
    </>
  ),
  pin: (
    <>
      <path d="M8 3.5h4l-.5 5 3 2.5H5.5l3-2.5z" />
      <path d="M10 11v5.5" />
    </>
  ),
  editor: (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" rx="2" />
      <path d="M7 13l.5-2 4.5-4.5 1.5 1.5L9 12.5z" />
    </>
  ),
  close: <path d="M5 5l10 10M15 5L5 15" />,
  move: (
    <path d="M10 3v14M3 10h14M10 3L8 5M10 3l2 2M10 17l-2-2M10 17l2-2M3 10l2-2M3 10l2 2M17 10l-2-2M17 10l-2 2" />
  ),
  record: (
    <>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3.5" fill="currentColor" />
    </>
  ),
  ocr: (
    <>
      <path d="M3.5 7V4.5a1 1 0 011-1H7M13 3.5h2.5a1 1 0 011 1V7M16.5 13v2.5a1 1 0 01-1 1H13M7 16.5H4.5a1 1 0 01-1-1V13" />
      <path d="M7 8h6M7 11h4.5" />
    </>
  ),
  scroll: (
    <>
      <rect x="5" y="2.5" width="10" height="15" rx="2" />
      <path d="M10 6v8M8 8l2-2 2 2M8 12l2 2 2-2" />
    </>
  ),
  upload: (
    <>
      <path d="M10 13V4M6.5 7.5L10 4l3.5 3.5" />
      <path d="M4 12.5v3a1 1 0 001 1h10a1 1 0 001-1v-3" />
    </>
  ),
  crop: <path d="M5 2.5V15h12.5M2.5 5H15v12.5" />,
  beautify: (
    <>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1" />
      <path d="M3 3h14v14H3z" opacity="0.5" />
    </>
  ),
  adjust: (
    <>
      <path d="M4 6h12M4 14h12" />
      <circle cx="8" cy="6" r="1.8" fill="currentColor" />
      <circle cx="13" cy="14" r="1.8" fill="currentColor" />
    </>
  ),
  invert: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 010 14z" fill="currentColor" />
    </>
  ),
  open: <path d="M3.5 6V15a1 1 0 001 1h11a1 1 0 001-1V8a1 1 0 00-1-1H10L8.5 5H4.5a1 1 0 00-1 1z" />,
  flipH: <path d="M10 3v14M7.5 6L3.5 14h4zM12.5 6l4 8h-4z" />,
  flipV: <path d="M3 10h14M6 7.5L14 3.5v4zM6 12.5l8 4v-4z" />,
  zoomIn: (
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2L17 17M6.5 8.5h4M8.5 6.5v4" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2L17 17M6.5 8.5h4" />
    </>
  ),
  fit: <path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" />,
  trash: <path d="M4.5 6h11M8 6V4h4v2M6 6l.8 10.5h6.4L14 6" />,
  folder: (
    <path d="M3.5 6V15a1 1 0 001 1h11a1 1 0 001-1V8a1 1 0 00-1-1H10L8.5 5H4.5a1 1 0 00-1 1z" />
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />
    </>
  ),
  pause: <path d="M7 4.5v11M13 4.5v11" />,
  stop: <rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" />,
  mic: (
    <>
      <rect x="7.5" y="3" width="5" height="9" rx="2.5" />
      <path d="M5 10a5 5 0 0010 0M10 15v2.5" />
    </>
  ),
  gif: (
    <>
      <rect x="2.5" y="5" width="15" height="10" rx="2" />
      <path d="M9.5 8H7v4h2.5v-2M11.5 8v4M14 12V8h2" />
    </>
  ),
  monitor: (
    <>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 16.5h6M10 13.5v3" />
    </>
  ),
  moon: <path d="M16.5 12.2A6.8 6.8 0 017.8 3.5a6.8 6.8 0 108.7 8.7z" />,
  sun: (
    <>
      <circle cx="10" cy="10" r="3.3" />
      <path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" />
    </>
  ),
  micOff: (
    <>
      <rect x="7.5" y="3" width="5" height="9" rx="2.5" />
      <path d="M5 10a5 5 0 0010 0M10 15v2.5" />
      <path d="M3.5 3.5l13 13" />
    </>
  ),
  speaker: (
    <>
      <path d="M3 8h3l4-3.5v11L6 12H3z" />
      <path d="M13 7.5a3.5 3.5 0 010 5M15.2 5a7 7 0 010 10" />
    </>
  ),
  speakerOff: (
    <>
      <path d="M3 8h3l4-3.5v11L6 12H3z" />
      <path d="M13.5 8l4 4M17.5 8l-4 4" />
    </>
  ),
  chevronDown: <path d="M6 8l4 4 4-4" />,
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
