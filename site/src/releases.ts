/*
  Reads anyshot's published releases from the GitHub API and picks out the installers.
  The build uses it to put every release into the page (plugins/releases.ts), and the
  page uses it again when it loads, so a release published after the last build shows
  up without waiting for the site to be rebuilt.
*/
import type { FileKind, Release } from 'virtual:releases';

export const REPO = 'mgamergo/anyshot';

/** Which release asset is which installer, by electron-builder's artifact names. */
const KINDS: [FileKind, RegExp][] = [
  ['win-x64', /^anyshot-Setup-.+-x64\.exe$/],
  ['win-arm64', /^anyshot-Setup-.+-arm64\.exe$/],
  ['deb', /^anyshot_.+_amd64\.deb$/],
  ['appimage', /^anyshot-.+-x86_64\.AppImage$/],
];

export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: { name: string; size: number; browser_download_url: string }[];
}

const semver = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
export function newestFirst(a: Release, b: Release): number {
  const x = semver(a.version);
  const y = semver(b.version);
  for (let i = 0; i < 3; i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Published releases that have at least one installer, newest first. */
export function toReleases(all: GitHubRelease[]): Release[] {
  return all
    .filter((r) => !r.draft && !r.prerelease)
    .map((r): Release => {
      const files: Release['files'] = {};
      for (const a of r.assets) {
        const kind = KINDS.find(([, re]) => re.test(a.name))?.[0];
        if (kind) files[kind] = { name: a.name, size: a.size, url: a.browser_download_url };
      }
      return {
        version: r.tag_name.replace(/^v/, ''),
        date: r.published_at ?? '',
        notesUrl: r.html_url,
        files,
      };
    })
    .filter((r) => Object.keys(r.files).length > 0)
    .sort(newestFirst);
}

/** Every page of the repository's releases. Throws when a request fails. */
export async function fetchReleases(
  headers: Record<string, string> = {},
  repo = REPO,
): Promise<Release[]> {
  const all: GitHubRelease[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
      { headers: { Accept: 'application/vnd.github+json', ...headers } },
    );
    if (!res.ok) {
      throw new Error(`GitHub releases request failed: ${res.status} ${res.statusText}`);
    }
    const batch = (await res.json()) as GitHubRelease[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return toReleases(all);
}
