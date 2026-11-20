/**
 * Merges electron-builder's update metadata (latest.yml) from separate builds of
 * the same version, such as the x64 and ARM64 NSIS installers: each build writes
 * a latest.yml listing only its own installer, and the release needs one that
 * lists both. electron-updater then picks the file whose name has its CPU
 * architecture (x64, arm64) in it.
 *
 * The first file is the base: its top-level `path` and `sha512` (read by old
 * updaters) stay. Only the `files:` lists are combined.
 *
 *   bun scripts/merge-update-metadata.ts out.yml first.yml second.yml
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Parsed {
  version: string;
  /** Lines before `files:`, the entries (each a list of lines), and the lines after. */
  head: string[];
  entries: string[][];
  tail: string[];
}

function parse(yml: string, name: string): Parsed {
  const lines = yml.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const start = lines.indexOf('files:');
  if (start < 0) throw new Error(`${name}: no files: list`);
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(
    lines.find((l) => l.startsWith('version:')) ?? '',
  )?.[1];
  if (!version) throw new Error(`${name}: no version`);
  let end = start + 1;
  while (end < lines.length && /^\s/.test(lines[end] ?? '')) end++;
  const entries: string[][] = [];
  for (const line of lines.slice(start + 1, end)) {
    if (/^\s*-\s/.test(line)) entries.push([line]);
    else {
      const last = entries.at(-1);
      if (!last) throw new Error(`${name}: malformed files: list`);
      last.push(line);
    }
  }
  if (entries.length === 0) throw new Error(`${name}: empty files: list`);
  return { version, head: lines.slice(0, start), entries, tail: lines.slice(end) };
}

const urlOf = (entry: string[]) => /url:\s*(\S+)/.exec(entry[0] ?? '')?.[1] ?? '';

export function mergeUpdateMetadata(first: string, ...rest: string[]): string {
  const base = parse(first, 'first file');
  const entries = [...base.entries];
  rest.forEach((yml, i) => {
    const other = parse(yml, `file ${i + 2}`);
    if (other.version !== base.version)
      throw new Error(`Versions differ: ${base.version} and ${other.version}`);
    for (const entry of other.entries)
      if (!entries.some((e) => urlOf(e) === urlOf(entry))) entries.push(entry);
  });
  return `${[...base.head, 'files:', ...entries.flat(), ...base.tail].join('\n')}\n`;
}

if (import.meta.main) {
  const [out, ...inputs] = process.argv.slice(2);
  if (!out || inputs.length < 2) {
    console.error('usage: merge-update-metadata.ts out.yml first.yml second.yml…');
    process.exit(2);
  }
  const [first = '', ...others] = inputs.map((file) => readFileSync(file, 'utf8'));
  writeFileSync(out, mergeUpdateMetadata(first, ...others));
  console.log(readFileSync(out, 'utf8'));
}
