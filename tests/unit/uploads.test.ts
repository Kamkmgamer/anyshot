import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { httpProvider, pickPath, s3Provider } from '../../src/main/upload-providers';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

let server: Server | undefined;
afterEach(() => server?.close());

async function serve(
  reply: (seen: Seen) => { status: number; body: string; location?: string },
): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const entry = {
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
      body: Buffer.concat(chunks),
    };
    seen.push(entry);
    const out = reply(entry);
    res
      .writeHead(out.status, {
        'content-type': 'application/json',
        ...(out.location ? { location: out.location } : {}),
      })
      .end(out.body);
  });
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const file = {
  bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
  name: 'shot.png',
  mime: 'image/png',
};

describe('upload providers', () => {
  it('reads nested JSON paths', () => {
    expect(pickPath({ data: { links: [{ url: 'x' }] } }, 'data.links.0.url')).toBe('x');
    expect(pickPath({ data: null }, 'data.url')).toBeUndefined();
  });

  it('HTTP: posts multipart with auth and returns the URL from the response', async () => {
    const { base, seen } = await serve(() => ({
      status: 200,
      body: '{"data":{"url":"https://img.example/abc.png"}}',
    }));
    const url = await httpProvider(
      { url: `${base}/upload`, fileField: 'image', responseUrlPath: 'data.url' },
      'Bearer t0k',
    ).upload(file);
    expect(url).toBe('https://img.example/abc.png');
    expect(seen[0]?.headers.authorization).toBe('Bearer t0k');
    expect(seen[0]?.headers['content-type']).toMatch(/^multipart\/form-data/);
    expect(seen[0]?.body.toString('latin1')).toContain('name="image"; filename="shot.png"');
  });

  it('HTTP: reports a missing URL and server errors', async () => {
    const { base } = await serve(({ url }) =>
      url === '/bad' ? { status: 500, body: 'nope' } : { status: 200, body: '{"ok":true}' },
    );
    const config = { url: `${base}/ok`, fileField: 'file', responseUrlPath: 'data.url' };
    await expect(httpProvider(config).upload(file)).rejects.toThrow(/no URL at "data.url"/);
    await expect(httpProvider({ ...config, url: `${base}/bad` }).upload(file)).rejects.toThrow(
      /500/,
    );
  });

  it('S3: signed path-style PUT of the exact bytes, public URL from the base', async () => {
    const { base, seen } = await serve(() => ({ status: 200, body: '' }));
    const when = new Date(Date.UTC(2026, 10, 19, 8, 0, 0));
    const url = await s3Provider(
      {
        endpoint: base,
        region: 'auto',
        bucket: 'shots',
        publicUrlBase: 'https://cdn.example',
        pathPrefix: 'team#1/{yyyy}/{MM}',
        publicRead: true,
      },
      { accessKeyId: 'AKID', secretAccessKey: 'SECRET' },
      () => when,
    ).upload(file);
    const req = seen[0];
    expect(req?.method).toBe('PUT');
    expect(req?.url).toBe('/shots/team%231/2026/11/shot.png');
    expect([...(req?.body ?? [])]).toEqual([...file.bytes]);
    expect(req?.headers['x-amz-acl']).toBe('public-read');
    expect(req?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/20261119\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-acl;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(url).toBe('https://cdn.example/team%231/2026/11/shot.png');
  });

  it('blocks remote cleartext uploads and does not follow redirects', async () => {
    const { base, seen } = await serve(() => ({
      status: 307,
      body: '',
      location: '/redirect-target',
    }));
    const http = (url: string) =>
      httpProvider({ url, fileField: 'file', responseUrlPath: 'url' }, 'Bearer test');
    const s3 = (endpoint: string) =>
      s3Provider(
        {
          endpoint,
          region: 'auto',
          bucket: 'shots',
          publicUrlBase: '',
          pathPrefix: 'captures',
          publicRead: false,
        },
        { accessKeyId: 'test', secretAccessKey: 'test' },
      );
    await expect(http('http://uploads.example').upload(file)).rejects.toThrow('require HTTPS');
    await expect(s3('http://uploads.example').upload(file)).rejects.toThrow('require HTTPS');
    await expect(http(`${base}/post`).upload(file)).rejects.toThrow('307');
    await expect(s3(base).upload(file)).rejects.toThrow('307');
    expect(seen.map(({ url }) => url)).toEqual(['/post', '/shots/captures/shot.png']);
  });
});
