import { createHash, createHmac } from 'node:crypto';

/** AWS Signature Version 4, enough for S3-compatible PUTs (R2, MinIO, B2, Spaces, AWS). */
export interface SignInput {
  method: string;
  url: URL;
  headers: Record<string, string>;
  /** Hex SHA-256 of the body, or `UNSIGNED-PAYLOAD`. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}

export const sha256Hex = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as AWS wants it; `/` is kept in paths. */
export function awsEncode(value: string, keepSlash = false): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? encoded.replace(/%2F/g, '/') : encoded;
}

function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a === b ? 0 : 1;
}

export function amzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Returns the headers to send, including `x-amz-date` and `authorization`. */
export function signV4(input: SignInput): Record<string, string> {
  const stamp = amzDate(input.date);
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries({
    ...input.headers,
    host: input.url.host,
    'x-amz-date': stamp,
  })) {
    headers[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  }
  const names = Object.keys(headers).sort();
  const query = [...input.url.searchParams.entries()]
    .map(([name, value]) => ({ name: awsEncode(name), value: awsEncode(value) }))
    .sort((a, b) => compare(a.name, b.name) || compare(a.value, b.value))
    .map(({ name, value }) => `${name}=${value}`)
    .join('&');
  const canonical = [
    input.method.toUpperCase(),
    awsEncode(decodeURIComponent(input.url.pathname), true) || '/',
    query,
    `${names.map((n) => `${n}:${headers[n]}`).join('\n')}\n`,
    names.join(';'),
    input.payloadHash,
  ].join('\n');
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), input.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}
