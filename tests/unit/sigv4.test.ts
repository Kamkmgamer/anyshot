import { describe, expect, it } from 'vitest';
import { amzDate, awsEncode, sha256Hex, signV4 } from '../../src/main/sigv4';

describe('SigV4', () => {
  it('matches the AWS signature test suite "get-vanilla" case', () => {
    const headers = signV4({
      method: 'GET',
      url: new URL('https://example.amazonaws.com/'),
      headers: {},
      payloadHash: sha256Hex(''),
      region: 'us-east-1',
      service: 'service',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      date: new Date(Date.UTC(2015, 7, 30, 12, 36, 0)),
    });
    expect(headers['x-amz-date']).toBe('20150830T123600Z');
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('encodes like AWS expects', () => {
    expect(awsEncode("a b!'()*")).toBe('a%20b%21%27%28%29%2A');
    expect(awsEncode('a/b c', true)).toBe('a/b%20c');
    expect(amzDate(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678)))).toBe('20260102T030405Z');
  });
});
