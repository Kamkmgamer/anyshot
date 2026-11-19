import type { ElectronApplication } from '@playwright/test';

/** Known colours drawn by the fixture "desktop", so captures can be checked pixel by pixel. */
export const FIXTURE = {
  background: [30, 64, 175] as const, // #1e40af
  card: { x: 100, y: 100, width: 300, height: 200, rgb: [225, 29, 72] as const }, // #e11d48
};

const html = `<!doctype html><meta charset="utf-8"><title>Fixture desktop</title>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#1e40af;font:15px system-ui,sans-serif;color:#0f172a}
.card{position:absolute;left:100px;top:100px;width:300px;height:200px;background:#e11d48}
.win{position:absolute;left:520px;top:120px;width:560px;height:380px;background:#f8fafc;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.4);overflow:hidden}
.win header{height:36px;background:#e2e8f0;display:flex;align-items:center;padding:0 14px;gap:7px}
.win header i{width:11px;height:11px;border-radius:50%;background:#94a3b8;display:block}
.win main{padding:22px 26px}
.win h1{margin:0 0 10px;font-size:24px}
.win p{margin:0 0 12px;line-height:1.5;color:#334155}
.chip{display:inline-block;padding:5px 10px;margin-right:8px;border-radius:999px;background:#ccfbf1;color:#115e59;font-weight:600}
</style>
<div class="card"></div>
<div class="win"><header><i></i><i></i><i></i></header><main>
<h1>Quarterly report</h1>
<p>Revenue grew 18% over the last quarter, led by the new self-serve plan.</p>
<p>Support tickets dropped while active teams doubled.</p>
<span class="chip">+18% revenue</span><span class="chip">2× teams</span>
</main></div>`;

/** Opens a full-screen fixture window that stands in for the user's desktop. */
export async function showFixture(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BrowserWindow, screen }, html) => {
    const { bounds } = screen.getPrimaryDisplay();
    const win = new BrowserWindow({ ...bounds, frame: false, show: false, title: 'fixture' });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    win.show();
    await win.webContents.executeJavaScript(
      'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
    );
    await new Promise((r) => setTimeout(r, 300));
  }, html);
}

export async function closeFixture(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.getURL().startsWith('data:')) w.destroy();
    }
  });
}
