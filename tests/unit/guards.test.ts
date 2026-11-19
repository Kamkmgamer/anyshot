import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('architecture guards', () => {
  it('main never polls: no setInterval', () => {
    const offenders = files('src/main').filter((f) =>
      /\bsetInterval\s*\(/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('main never statically imports heavy modules', () => {
    const heavy = /from ['"](tesseract\.js|mediabunny|gifenc|sharp)['"]/;
    const offenders = files('src/main').filter((f) => heavy.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the engine has no UI framework imports', () => {
    const ui = /from ['"](preact|react)(\/|['"])/;
    const offenders = files('src/engine').filter((f) => ui.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no window allows node integration or disables isolation', () => {
    const bad =
      /nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|webSecurity:\s*false/;
    const offenders = files('src/main').filter((f) => bad.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
