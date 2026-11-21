import type { Plugin } from 'vite';
import { fetchReleases } from '../src/releases';

async function load(repo: string) {
  const headers: Record<string, string> = { 'User-Agent': 'anyshot-site-build' };
  // CI passes its token so the build isn't subject to the anonymous rate limit.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const list = await fetchReleases(headers, repo);
  if (list.length === 0) throw new Error(`No published releases with installers in ${repo}`);
  return list;
}

/**
 * Provides `virtual:releases`: every published release of `repo` with its installer
 * downloads, fetched from the GitHub API once per build (or dev server start). The page
 * checks for newer releases again when it loads (see src/install.ts).
 */
export function releases({ repo }: { repo: string }): Plugin {
  const id = 'virtual:releases';
  const resolved = `\0${id}`;
  let data: ReturnType<typeof load> | undefined;
  return {
    name: 'anyshot-releases',
    resolveId(source) {
      return source === id ? resolved : undefined;
    },
    async load(source) {
      if (source !== resolved) return undefined;
      data ??= load(repo);
      const list = await data;
      this.info(`${list.length} releases, latest ${list[0]?.version}`);
      return `export default ${JSON.stringify(list)};`;
    },
  };
}
