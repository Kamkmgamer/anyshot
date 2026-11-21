/*
  Install table: OS tabs, an architecture toggle, a copyable command and a direct
  download per row, and a version picker. Every link and size comes from the
  release assets on GitHub: read when the site is built, and read again when the page
  loads, so a newer release shows up even before the site is rebuilt.
*/
import './install.css';
import built, { type Asset, type FileKind, type Release } from 'virtual:releases';
import { ICONS, must, WINDOWS_LOGO } from './icons';
import { fetchReleases } from './releases';

type Os = 'win' | 'linux';
type Arch = 'x64' | 'arm64';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

export function detectPlatform(): { os: Os; arch: Arch } {
  const ua = navigator.userAgent;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
  if (/linux/i.test(platform + ua) && !/android/i.test(ua)) return { os: 'linux', arch: 'x64' };
  return { os: 'win', arch: /arm/i.test(platform) ? 'arm64' : 'x64' };
}

function downloadButton(asset: Asset): string {
  const label = `Download ${asset.name}`;
  return `<a class="in-btn primary" href="${esc(asset.url)}" aria-label="${esc(label)}">${ICONS.download}<span class="tip">${esc(label)}</span></a>`;
}
function copyButton(command: string): string {
  return `<button class="in-btn" type="button" data-copy="${esc(command)}" aria-label="Copy command">${ICONS.copySmall}<span class="tip">Copy</span></button>`;
}
function command(text: string): string {
  return `<code class="in-cmd" title="${esc(text)}">${esc(text)}</code>`;
}
function missing(version: string): string {
  return `<span class="in-missing">Not part of ${esc(version)}</span>`;
}

function versionOptions(list: Release[]): string {
  return list
    .map(
      (r, i) =>
        `<option value="${esc(r.version)}">${esc(r.version)}${i ? '' : ' (latest)'}</option>`,
    )
    .join('');
}

export function mountInstall(el: HTMLElement) {
  let releases = built;
  let latest = releases[0] as Release;
  const state = { ...detectPlatform(), version: latest.version };
  const release = () => releases.find((r) => r.version === state.version) ?? latest;
  const asset = (kind: FileKind) => release().files[kind];

  el.classList.add('in');
  el.innerHTML = `
    <div class="in-top">
      <div class="in-tabs" role="tablist" aria-label="Operating system">
        <button type="button" role="tab" data-os="win">${WINDOWS_LOGO}Windows</button>
        <button type="button" role="tab" data-os="linux">${ICONS.terminal}Linux</button>
      </div>
      <label class="in-ver">Version
        <select>${versionOptions(releases)}</select>
      </label>
    </div>
    <div class="in-table" role="tabpanel"></div>
    <p class="in-note"></p>`;
  const table = must(el, '.in-table');
  const note = must(el, '.in-note');

  function windowsRows(): string {
    const kind: FileKind = state.arch === 'x64' ? 'win-x64' : 'win-arm64';
    const file = asset(kind);
    const spec = state.arch === 'x64' ? 'Windows 10 and 11, Intel or AMD' : 'Windows 11 on ARM';
    const seg = (['x64', 'arm64'] as const)
      .map(
        (a) =>
          `<button type="button" role="radio" data-arch="${a}" aria-checked="${state.arch === a}">${a === 'x64' ? 'x64' : 'ARM64'}</button>`,
      )
      .join('');
    const installer = `
      <div class="in-row"><span class="in-label">Installer</span>
        <div class="in-mid"><div class="in-seg" role="radiogroup" aria-label="Processor">${seg}</div>
          <span class="in-spec">${file ? `${spec}, ${mb(file.size)}` : missing(state.version)}</span></div>
        <div class="in-acts">${file ? downloadButton(file) : ''}</div></div>`;
    if (!file) return installer;
    const ps = `Invoke-WebRequest ${file.url} -OutFile ${file.name}; .\\${file.name}`;
    return `${installer}
      <div class="in-row"><span class="in-label">PowerShell</span>${command(ps)}<div class="in-acts">${copyButton(ps)}</div></div>`;
  }

  function linuxRow(
    label: string,
    detail: string,
    file: Asset | undefined,
    run: (f: Asset) => string,
  ): string {
    if (!file) {
      return `<div class="in-row"><span class="in-label">${label}<small>${detail}</small></span>${missing(state.version)}<div class="in-acts"></div></div>`;
    }
    const cmd = run(file);
    return `<div class="in-row"><span class="in-label">${label}<small>${detail}, ${mb(file.size)}</small></span>${command(cmd)}<div class="in-acts">${copyButton(cmd)}${downloadButton(file)}</div></div>`;
  }

  function draw() {
    for (const b of el.querySelectorAll<HTMLElement>('[data-os]')) {
      b.setAttribute('aria-selected', String(b.dataset.os === state.os));
    }
    const r = release();
    const notes = `<a href="${esc(r.notesUrl)}" target="_blank" rel="noopener noreferrer">Release notes for ${esc(r.version)}</a>.`;
    if (state.os === 'win') {
      table.innerHTML = windowsRows();
      note.innerHTML = `The installer isn't code-signed yet, so SmartScreen may warn the first time: choose More info, then Run anyway. ${notes}`;
    } else {
      table.innerHTML =
        linuxRow(
          'Debian, Ubuntu',
          '.deb, x64',
          asset('deb'),
          (f) => `curl -LO ${f.url} && sudo apt install ./${f.name}`,
        ) +
        linuxRow(
          'Any distribution',
          'AppImage, x64',
          asset('appimage'),
          (f) => `curl -LO ${f.url} && chmod +x ${f.name} && ./${f.name}`,
        );
      note.innerHTML = `X11 is the tested path. On Wayland, captures go through your desktop's screen-sharing portal, and you may need to bind <code>anyshot --capture</code> to a shortcut yourself. ${notes}`;
    }
  }

  el.addEventListener('click', async (e) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-os], [data-arch], [data-copy]');
    if (!t) return;
    if (t.dataset.os) state.os = t.dataset.os as Os;
    if (t.dataset.arch) state.arch = t.dataset.arch as Arch;
    const text = t.dataset.copy;
    if (text !== undefined) {
      const tip = must(t, '.tip');
      try {
        await navigator.clipboard.writeText(text);
        t.classList.add('done');
        tip.textContent = 'Copied';
        t.firstElementChild?.replaceWith(
          document.createRange().createContextualFragment(ICONS.check),
        );
        setTimeout(() => {
          t.classList.remove('done');
          tip.textContent = 'Copy';
          t.firstElementChild?.replaceWith(
            document.createRange().createContextualFragment(ICONS.copySmall),
          );
        }, 1600);
      } catch {
        tip.textContent = 'Select it and copy instead';
        t.classList.add('done');
      }
      return;
    }
    draw();
  });
  const select = must<HTMLSelectElement>(el, 'select');
  select.addEventListener('change', () => {
    state.version = select.value;
    draw();
  });
  draw();

  // Releases published (or installers added or replaced) since the build. Anonymous API requests are rate-limited per
  // visitor; when this fails, the page keeps the releases it was built with.
  fetchReleases()
    .then((fresh) => {
      const newest = fresh[0];
      if (!newest || JSON.stringify(fresh) === JSON.stringify(releases)) return;
      const onLatest = state.version === latest.version;
      releases = fresh;
      latest = newest;
      if (onLatest || !fresh.some((r) => r.version === state.version))
        state.version = newest.version;
      select.innerHTML = versionOptions(releases);
      select.value = state.version;
      draw();
    })
    .catch((error: unknown) => {
      console.warn('[install] could not check for newer releases', error);
    });
}
