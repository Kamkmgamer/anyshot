import type { FileKind, Release } from 'virtual:releases';
import type { Plugin } from 'vite';

/** Which release asset is which installer, by electron-builder's artifact names. */
const KINDS: [FileKind, RegExp][] = [
  ['win-x64', /^anyshot-Setup-.+-x64\.exe$/],
  ['win-arm64', /^anyshot-Setup-.+-arm64\.exe$/],
  ['deb', /^anyshot_.+_amd64\.deb$/],
  ['appimage', /^anyshot-.+-x86_64\.AppImage$/],
];

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: { name: string; size: number; browser_download_url: string }[];
}

const semver = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
function newestFirst(a: Release, b: Release): number {
  const x = semver(a.version);
  const y = semver(b.version);
  for (let i = 0; i < 3; i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

async function fetchReleases(repo: string): Promise<Release[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'anyshot-site-build',
  };
  // CI passes its token so the build isn't subject to the anonymous rate limit.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const all: GitHubRelease[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
      {
        headers,
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub releases request failed: ${res.status} ${res.statusText}`);
    }
    const batch = (await res.json()) as GitHubRelease[];
    all.push(...batch);
    if (batch.length < 100) break;
  }

  const list = all
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

  if (list.length === 0) throw new Error(`No published releases with installers in ${repo}`);
  return list;
}

/**
 * Provides `virtual:releases`: every published release of `repo` with its installer
 * downloads, fetched from the GitHub API once per build (or dev server start).
 */
export function releases({ repo }: { repo: string }): Plugin {
  const id = 'virtual:releases';
  const resolved = `\0${id}`;
  let data: Promise<Release[]> | undefined;
  return {
    name: 'anyshot-releases',
    resolveId(source) {
      return source === id ? resolved : undefined;
    },
    async load(source) {
      if (source !== resolved) return undefined;
      data ??= fetchReleases(repo);
      const list = await data;
      this.info(`${list.length} releases, latest ${list[0]?.version}`);
      return `export default ${JSON.stringify(list)};`;
    },
  };
}
