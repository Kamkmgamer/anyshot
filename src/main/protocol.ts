import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { protocol } from 'electron';
import { getFrame } from './frames';
import { paths } from './paths';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

export type MediaResolver = (path: string, request: Request) => Promise<Response | null>;
const mediaRoutes = new Map<string, MediaResolver>();

/** Registers a resolver for `app://local/@<prefix>/...` URLs (history images, pins). */
export function registerMediaRoute(prefix: string, resolver: MediaResolver): void {
  mediaRoutes.set(prefix, resolver);
}

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        codeCache: true,
        stream: true,
      },
    },
  ]);
}

export function handleAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'local') return notFound();
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/@frame/')) {
      const frame = getFrame(pathname.slice('/@frame/'.length));
      if (!frame) return notFound();
      return new Response(frame.rgba as Uint8Array<ArrayBuffer>, {
        headers: {
          'content-type': 'application/octet-stream',
          'x-frame-width': String(frame.width),
          'x-frame-height': String(frame.height),
        },
      });
    }

    if (pathname.startsWith('/@')) {
      const slash = pathname.indexOf('/', 2);
      const prefix = pathname.slice(2, slash === -1 ? undefined : slash);
      const resolver = mediaRoutes.get(prefix);
      const rest = slash === -1 ? '' : pathname.slice(slash + 1);
      return (resolver && (await resolver(rest, request))) ?? notFound();
    }

    return serveBundle(pathname);
  });
}

async function serveBundle(pathname: string): Promise<Response> {
  const file = normalize(join(paths.renderer, pathname));
  const rel = relative(paths.renderer, file);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return notFound();
  try {
    const body = await readFile(file);
    return new Response(body, {
      headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' },
    });
  } catch {
    return notFound();
  }
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}
