import type { ReactNode } from 'react';

export type IconName =
  | 'select' | 'hand' | 'pen' | 'highlight' | 'eraser' | 'rect' | 'ellipse' | 'diamond'
  | 'line' | 'arrow' | 'text' | 'sparkle' | 'undo' | 'redo' | 'trash' | 'copy' | 'download'
  | 'sun' | 'moon' | 'plus' | 'minus' | 'fit' | 'close' | 'check' | 'retry' | 'fill'
  | 'work' | 'calc' | 'steps' | 'target' | 'alert' | 'clock' | 'shapes' | 'touch'
  | 'play' | 'pause' | 'stepf' | 'sliders' | 'front' | 'back' | 'more' | 'atom' | 'edit' | 'cut' | 'paste' | 'selectall'
  | 'wand' | 'blocks' | 'library' | 'rotate' | 'flip' | 'progress' | 'ruler'
  | 'sidebar' | 'users' | 'mic' | 'micOff' | 'headset' | 'hangup' | 'share' | 'link' | 'search' | 'book' | 'chart'
  | 'lock' | 'layers' | 'logout' | 'chevron' | 'goBack' | 'help';

const PATHS: Record<IconName, ReactNode> = {
  select: <path d="M6 3.5l12.5 6.3-5.6 1.8-1.9 5.7z" />,
  hand: (
    <>
      <path d="M8.5 12V6.5a1.5 1.5 0 013 0V11" />
      <path d="M11.5 10.5V5a1.5 1.5 0 013 0v6" />
      <path d="M14.5 10.5V7a1.5 1.5 0 013 0v7c0 3.3-2.2 6-5.4 6-2.2 0-3.6-1-4.9-3l-2.4-3.6a1.4 1.4 0 012.2-1.7l1.5 1.8" />
    </>
  ),
  pen: (
    <>
      <path d="M4.5 19.5l.9-3.9L16.6 4.4a2.1 2.1 0 013 3L8.4 18.6z" />
      <path d="M14.6 6.4l3 3" />
    </>
  ),
  highlight: (
    <>
      <path d="M9.2 14.3l5.6-5.6 3 3-5.6 5.6H9.2z" />
      <path d="M14.8 8.7l1.6-1.6a1.4 1.4 0 012 0l1 1a1.4 1.4 0 010 2l-1.6 1.6" />
      <path d="M4.5 20h7" />
    </>
  ),
  eraser: (
    <>
      <path d="M5.2 14.3l8.1-8.1a1.8 1.8 0 012.5 0l3 3a1.8 1.8 0 010 2.5l-7.2 7.2H8.2l-3-3a1.8 1.8 0 010-1.6z" />
      <path d="M9 10.5l5.5 5.5" />
      <path d="M12 20h7.5" />
    </>
  ),
  rect: <rect x="4" y="6" width="16" height="12" rx="2.5" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  diamond: <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" />,
  line: <path d="M5.5 18.5l13-13" />,
  arrow: (
    <>
      <path d="M5.5 18.5l13-13" />
      <path d="M10 5.5h8.5V14" />
    </>
  ),
  text: (
    <>
      <path d="M5.5 7V5.5h13V7" />
      <path d="M12 5.5v13" />
      <path d="M9.5 18.5h5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M10.5 4l1.8 5.2 5.2 1.8-5.2 1.8-1.8 5.2-1.8-5.2L3.5 11l5.2-1.8z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14.5L4 9.5l5-5" />
      <path d="M4 9.5h10a6 6 0 010 12h-3" />
    </>
  ),
  redo: (
    <>
      <path d="M15 14.5l5-5-5-5" />
      <path d="M20 9.5H10a6 6 0 000 12h3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 13h9l1-13" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A2.5 2.5 0 017.5 4H16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7.5 11L12 15.5 16.5 11" />
      <path d="M5 20h14" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  retry: (
    <>
      <path d="M19.5 11a7.5 7.5 0 10-2.2 5.7" />
      <path d="M19.5 4.5V11H13" />
    </>
  ),
  work: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M14 4.5v15" />
      <path d="M16.5 8.5h1.5M16.5 11.5h1.5" />
    </>
  ),
  calc: (
    <>
      <rect x="5.5" y="3.5" width="13" height="17" rx="2.5" />
      <path d="M8.5 7.5h7" />
      <path d="M9 12h.01M12 12h.01M15 12h.01M9 15.5h.01M12 15.5h.01M15 15.5h.01" strokeWidth={2.4} />
    </>
  ),
  steps: (
    <>
      <path d="M10 6.5h9.5M10 12h9.5M10 17.5h9.5" />
      <path d="M4.5 5.5l1.2-.8v3.8M4.2 11.2a1.2 1.2 0 012.3.4c0 .9-2.3 1.7-2.3 2.6h2.4M4.3 16.4h2l-1.1 1.2c.8 0 1.3.4 1.3 1s-.5 1-1.2 1c-.5 0-.9-.2-1.1-.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4.5M12 17.2h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  shapes: (
    <>
      <circle cx="8.5" cy="8.5" r="4.2" />
      <rect x="12.5" y="12.5" width="8" height="8" rx="1.6" />
      <path d="M3.8 20.5l3.7-6.4 3.7 6.4z" />
    </>
  ),
  touch: (
    <>
      <path d="M10 12V5.5a1.5 1.5 0 013 0V12" />
      <path d="M13 12.5v-1a1.5 1.5 0 013 0v1" />
      <path d="M16 13v-.5a1.5 1.5 0 013 0V16c0 3-2.3 5-5.3 5-2.4 0-3.9-1-5-2.6l-3-4.2a1.5 1.5 0 012.3-1.9L10 15" />
    </>
  ),
  fill: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <path d="M5.5 14l8.5-8.5M5.5 19l13.5-13.5M11 19l8-8" />
    </>
  ),  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />,
  pause: <path d="M8 5.5v13M16 5.5v13" strokeWidth={3} />,
  stepf: (
    <>
      <path d="M6 5.5v13l9-6.5z" fill="currentColor" />
      <path d="M18 5.5v13" strokeWidth={2.4} />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </>
  ),
  front: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" fill="currentColor" fillOpacity={0.25} />
      <path d="M15 6V5a1 1 0 00-1-1H5a1 1 0 00-1 1v9a1 1 0 001 1h1" />
    </>
  ),
  back: (
    <>
      <rect x="4" y="4" width="11" height="11" rx="2" fill="currentColor" fillOpacity={0.25} />
      <path d="M18 9h1a1 1 0 011 1v9a1 1 0 01-1 1h-9a1 1 0 01-1-1v-1" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  atom: (
    <>
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5l.9-3.9L16.6 4.4a2.1 2.1 0 013 3L8.4 18.6z" />
      <path d="M13 20h7" />
    </>
  ),
  cut: (
    <>
      <circle cx="6.5" cy="17.5" r="2.8" />
      <circle cx="17.5" cy="17.5" r="2.8" />
      <path d="M8.5 15.5L18 4M15.5 15.5L6 4" />
    </>
  ),
  paste: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 5V4a1 1 0 011-1h4a1 1 0 011 1v1M9 11h6M9 15h4" />
    </>
  ),
  selectall: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2.5" strokeDasharray="3 2.6" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  wand: (
    <>
      <path d="M4.5 19.5L15 9" />
      <path d="M13.2 7.2l3.6 3.6" />
      <path d="M17.5 3.5v3M16 5h3M20 9.5v2M19 10.5h2M10 3.5v2M9 4.5h2" />
    </>
  ),
  blocks: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
      <circle cx="16.5" cy="7.5" r="3.3" />
      <path d="M7.5 13v7M4 16.5h7" />
    </>
  ),
  library: (
    <>
      <path d="M5 4.5v15M9 4.5v15" />
      <path d="M13 5.2l3.6-1 4 14.6-3.6 1z" />
    </>
  ),
  progress: <path d="M5 19.5V14M10 19.5V9M15 19.5v-4M20 19.5V5" />,
  ruler: <path d="M3.5 15.5l12-12 5 5-12 12zM7.5 11.5l1.8 1.8M10.5 8.5l1.8 1.8M13.5 5.5l1.8 1.8" />,
  rotate: (
    <>
      <path d="M19.5 12a7.5 7.5 0 11-2.2-5.3" />
      <path d="M19.8 4.5v4.2h-4.2" />
    </>
  ),
  flip: (
    <>
      <path d="M12 3.5v17" strokeDasharray="2.4 2.4" />
      <path d="M9 7L4 17h5zM15 7l5 10h-5z" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.6.7 2.6 2.3 3 4.7" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  micOff: (
    <>
      <path d="M15 9.5v-3a3 3 0 0 0-5.6-1.5M9 9v2.5a3 3 0 0 0 4.6 2.5" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 10.4 5.2M18.3 13.3c.1-.6.2-1.2.2-1.8M12 18v2.5M4 4l16 16" />
    </>
  ),
  headset: (
    <>
      <path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3" />
      <rect x="3.5" y="14" width="4" height="6" rx="1.5" />
      <rect x="16.5" y="14" width="4" height="6" rx="1.5" />
    </>
  ),
  hangup: <path d="M3.5 14.5c4.8-4.4 12.2-4.4 17 0l-2 2.3-3.3-1.4v-2.2a9.5 9.5 0 0 0-6.4 0v2.2l-3.3 1.4z" />,
  share: (
    <>
      <path d="M12 15V3.5M8 7.5l4-4 4 4" />
      <path d="M5.5 11.5v7a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-7" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5L20 20" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5h10.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z" />
      <path d="M5 18a2 2 0 0 1 2-2h10.5M9 8.5h5" />
    </>
  ),
  chart: <path d="M4 20h16M7 16v-4M12 16V7M17 16v-6" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  layers: (
    <>
      <path d="M12 4l8.5 4.5L12 13 3.5 8.5z" />
      <path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </>
  ),
  chevron: <path d="M9.5 6l6 6-6 6" />,
  goBack: <path d="M14.5 6l-6 6 6 6" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6" />
      <path d="M12 17h.01" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
