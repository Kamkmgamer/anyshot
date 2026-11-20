/**
 * Update logic that doesn't need Electron: what an update offer looks like,
 * whether this install can update itself, the short notes shown to the user,
 * and the startup check with its dependencies injected.
 */

export const RELEASES_URL = 'https://github.com/mgamergo/anyshot/releases';

export interface UpdateOffer {
  version: string;
  current: string;
  /** A few lines from the release notes. */
  notes: string[];
  releaseUrl: string;
  /** The install can replace itself (NSIS, AppImage); otherwise the user downloads the release (.deb). */
  canInstall: boolean;
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'downloading'; percent: number }
  | { state: 'installing' }
  | { state: 'error'; message: string };

/**
 * Whether this install can download and apply an update by itself: the NSIS
 * installer on Windows and an AppImage (which sets APPIMAGE) on Linux can; a
 * .deb belongs to the package manager.
 */
export function canSelfUpdate(platform: string, env: Record<string, string | undefined>): boolean {
  if (platform === 'win32') return true;
  return platform === 'linux' && !!env.APPIMAGE;
}

export function releaseUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#39|[a-z]+);/g, (m, name: string) => ENTITIES[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A few lines worth showing from release notes (HTML from GitHub, or Markdown):
 * the list items, i.e. the changes, without the download table, links or
 * "by @user in #12" credits.
 */
export function shortNotes(notes: string | null | undefined, max = 5): string[] {
  if (!notes) return [];
  const html = /<li[\s>]/i.test(notes);
  const items = html
    ? [...notes.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => plain(m[1] ?? ''))
    : notes
        .split('\n')
        .map((line) => /^\s*[-*]\s+(.*)$/.exec(line)?.[1] ?? '')
        .map((line) => line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, ''));
  const lines = items
    .map((line) => line.replace(/\s+by @\S+ in \S+$/i, '').replace(/\s+in https?:\/\/\S+$/i, ''))
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^full changelog/i.test(line));
  const shown = lines.slice(0, max);
  if (lines.length > max) shown.push(`…and ${lines.length - max} more`);
  return shown;
}

/** What the startup check needs; injected so it can be tested without Electron or a network. */
export interface UpdateCheckDeps {
  /** The app is packaged (not `electron .` in development or tests) and the user allows checks. */
  enabled: boolean;
  current: string;
  canInstall: boolean;
  /** The newer release, or null when this is the latest. Rejects when offline. */
  check(): Promise<{ version: string; releaseNotes: string | null } | null>;
  offer(offer: UpdateOffer): void;
  log(message: string): void;
}

/** Checks for a newer release once and offers it; never throws (offline, rate limits, no release). */
export async function checkForUpdate(deps: UpdateCheckDeps): Promise<UpdateOffer | null> {
  if (!deps.enabled) return null;
  let found: Awaited<ReturnType<UpdateCheckDeps['check']>>;
  try {
    found = await deps.check();
  } catch (error) {
    deps.log(`update check failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (!found || found.version === deps.current) return null;
  const offer: UpdateOffer = {
    version: found.version,
    current: deps.current,
    notes: shortNotes(found.releaseNotes),
    releaseUrl: releaseUrl(found.version),
    canInstall: deps.canInstall,
  };
  deps.offer(offer);
  return offer;
}
