const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * Expands a filename template such as `anyshot {date} at {time}`. A `/` makes
 * sub-folders. Characters Windows forbids are replaced, and `..` segments are
 * dropped so a template can never escape the save folder.
 */
export function expandTemplate(template: string, now: Date, random = Math.random): string {
  const tokens: Record<string, string> = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`,
    timestamp: `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    unix: String(Math.floor(now.getTime() / 1000)),
    yyyy: String(now.getFullYear()),
    MM: pad(now.getMonth() + 1),
    dd: pad(now.getDate()),
    HH: pad(now.getHours()),
    mm: pad(now.getMinutes()),
    ss: pad(now.getSeconds()),
    ms: pad(now.getMilliseconds(), 3),
    random: Math.floor(random() * 0xffffff)
      .toString(16)
      .padStart(6, '0'),
  };
  const expanded = template.replace(/\{(\w+)\}/g, (match, name: string) => tokens[name] ?? match);
  const segments = expanded
    .split(/[\\/]+/)
    .map((segment) =>
      segment
        // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
        .replace(/[<>:"|?*\u0000-\u001f]/g, '-')
        .replace(/[. ]+$/, '')
        .trim(),
    )
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  return segments.length > 0 ? segments.join('/') : 'anyshot';
}

export const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;
