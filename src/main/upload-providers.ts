import { expandTemplate } from '../shared/filename';
import type { Settings } from '../shared/settings';
import { awsEncode, sha256Hex, signV4 } from './sigv4';

// Upload providers. No Electron imports, so they are unit-tested against a local server.

export interface UploadFile {
  bytes: Uint8Array;
  name: string;
  mime: string;
}

/** An upload destination. Returns the public URL of the uploaded file. */
export interface UploadProvider {
  upload(file: UploadFile): Promise<string>;
}

/** Reads `a.b.0.c` style paths out of a JSON response. */
export function pickPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>(
      (v, key) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined),
      value,
    );
}

function uploadUrl(value: string, missingMessage: string): URL {
  const url = URL.parse(value);
  if (!url) throw new Error(missingMessage);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Uploads require HTTPS, except for HTTP on 127.0.0.1 or [::1].');
  }
  return url;
}

/** Generic HTTP: multipart POST, URL read from the JSON response (imgur/imgbb-style APIs, own servers). */
export function httpProvider(
  config: Settings['uploads']['http'],
  authorization?: string,
): UploadProvider {
  return {
    async upload(file) {
      const endpoint = uploadUrl(config.url, 'Set an upload URL in Settings ▸ Uploads.');
      const form = new FormData();
      form.append(
        config.fileField || 'file',
        new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.mime }),
        file.name,
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'manual',
        body: form,
        headers: authorization ? { authorization } : {},
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Upload failed: ${response.status} ${text.slice(0, 200)}`);
      let url: unknown;
      try {
        url = pickPath(JSON.parse(text), config.responseUrlPath);
      } catch {
        url = text.trim();
      }
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        throw new Error(`The server's response has no URL at "${config.responseUrlPath}".`);
      }
      return url;
    },
  };
}

/** S3-compatible PUT (AWS, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces). */
export function s3Provider(
  config: Settings['uploads']['s3'],
  credentials: { accessKeyId: string; secretAccessKey: string },
  now = () => new Date(),
): UploadProvider {
  return {
    async upload(file) {
      const missing = 'Set the S3 endpoint and bucket in Settings ▸ Uploads.';
      if (!config.bucket) throw new Error(missing);
      const endpoint = uploadUrl(config.endpoint, missing);
      const date = now();
      const key = `${expandTemplate(config.pathPrefix, date)}/${file.name}`.replace(/^\/+/, '');
      const base = endpoint.href.replace(/\/+$/, '');
      const encodedKey = awsEncode(key, true);
      // Path-style addressing works with every S3-compatible service.
      const url = new URL(`${base}/${config.bucket}/${encodedKey}`);
      const headers = signV4({
        method: 'PUT',
        url,
        headers: {
          'content-type': file.mime,
          'x-amz-content-sha256': sha256Hex(file.bytes),
          ...(config.publicRead ? { 'x-amz-acl': 'public-read' } : {}),
        },
        payloadHash: sha256Hex(file.bytes),
        region: config.region || 'auto',
        service: 's3',
        ...credentials,
        date,
      });
      const { host: _host, ...sendHeaders } = headers;
      const response = await fetch(url, {
        method: 'PUT',
        redirect: 'manual',
        body: file.bytes as Uint8Array<ArrayBuffer>,
        headers: sendHeaders,
      });
      if (!response.ok)
        throw new Error(
          `S3 upload failed: ${response.status} ${(await response.text()).slice(0, 200)}`,
        );
      const publicBase = (config.publicUrlBase || `${base}/${config.bucket}`).replace(/\/+$/, '');
      return `${publicBase}/${encodedKey}`;
    },
  };
}
