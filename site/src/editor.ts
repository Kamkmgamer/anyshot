/** The editor the demo plays over: anyshot's own src/engine/beautify.ts. */
import { ICONS } from './icons';

export const TERMINAL_IDLE =
  '<span class="dim">Checked 214 files in 41ms. No fixes applied.</span>';

export const EDITOR = `
    <nav class="e-act"><i class="on">${ICONS.files}</i><i>${ICONS.search}</i><i>${ICONS.branch}</i><i>${ICONS.run}</i><i>${ICONS.extensions}</i></nav>
    <aside class="e-side"><h6>Explorer</h6><div class="e-tree">
      <div style="--d:8px"><span class="chev">▾</span>anyshot</div>
      <div style="--d:18px"><span class="chev">▾</span>src</div>
      <div style="--d:28px"><span class="chev">▾</span>engine</div>
      <div style="--d:46px" class="on"><span class="ts">TS</span>beautify.ts</div>
      <div style="--d:46px"><span class="ts">TS</span>compose.ts</div>
      <div style="--d:46px"><span class="ts">TS</span>history.ts</div>
      <div style="--d:46px"><span class="ts">TS</span>render.ts</div>
      <div style="--d:46px"><span class="ts">TS</span>shapes.ts</div>
      <div style="--d:28px"><span class="chev">▸</span>main</div>
      <div style="--d:28px"><span class="chev">▸</span>windows</div>
      <div style="--d:18px"><span class="chev">▸</span>tests</div>
      <div style="--d:22px"><span class="ts js">{}</span>package.json</div>
      <div style="--d:22px"><span class="ts md">M</span>README.md</div>
    </div></aside>
    <div class="e-main">
      <div class="e-tabs"><span class="on"><span class="ts">TS</span>beautify.ts</span><span><span class="ts">TS</span>render.ts</span></div>
      <div class="e-crumbs">src <span>›</span> engine <span>›</span> beautify.ts <span>›</span> BACKGROUNDS</div>
      <div class="e-code"><div data-l="1"><b>1</b><span><span class="k">import</span> <span class="kw">type</span> { <span class="t">Beautify</span> } <span class="k">from</span> <span class="s">'./model'</span>;</span></div><div data-l="2"><b>2</b><span><span class="k">import</span> { <span class="kw">type</span> <span class="t">Ctx</span>, <span class="f">roundRectPath</span> } <span class="k">from</span> <span class="s">'./render'</span>;</span></div><div data-l="3"><b>3</b><span></span></div><div data-l="4"><b>4</b><span><span class="c">/** Built-in backgrounds for Beautify: two-stop diagonal gradients. */</span></span></div><div data-l="5"><b>5</b><span><span class="k">export</span> <span class="kw">const</span> <span class="v">BACKGROUNDS</span>: <span class="kw">readonly</span> [<span class="t">string</span>, <span class="t">string</span>][] = [</span></div><div data-l="6"><b>6</b><span>  [<span class="s">'#5eead4'</span>, <span class="s">'#6366f1'</span>],</span></div><div data-l="7"><b>7</b><span>  [<span class="s">'#fda4af'</span>, <span class="s">'#f59e0b'</span>],</span></div><div data-l="8"><b>8</b><span>  [<span class="s">'#a5b4fc'</span>, <span class="s">'#ec4899'</span>],</span></div><div data-l="9" class="cur"><b>9</b><span>  [<span class="s">'#86efac'</span>, <span class="s">'#0ea5e9'</span>],</span></div><div data-l="10"><b>10</b><span>  [<span class="s">'#fde68a'</span>, <span class="s">'#f97316'</span>],</span></div><div data-l="11"><b>11</b><span>  [<span class="s">'#e2e8f0'</span>, <span class="s">'#94a3b8'</span>],</span></div><div data-l="12"><b>12</b><span>  [<span class="s">'#1e293b'</span>, <span class="s">'#0f172a'</span>],</span></div><div data-l="13"><b>13</b><span>  [<span class="s">'#c4b5fd'</span>, <span class="s">'#22d3ee'</span>],</span></div><div data-l="14"><b>14</b><span>];</span></div><div data-l="15"><b>15</b><span></span></div><div data-l="16"><b>16</b><span><span class="kw">function</span> <span class="f">colors</span>(<span class="v">b</span>: <span class="t">Beautify</span>): [<span class="t">string</span>, <span class="t">string</span>] {</span></div><div data-l="17"><b>17</b><span>  <span class="k">return</span> <span class="v">BACKGROUNDS</span>[<span class="v">b</span>.background % <span class="v">BACKGROUNDS</span>.length] ?? [<span class="s">'#ffffff'</span>, <span class="s">'#ffffff'</span>];</span></div></div>
      <div class="e-panel">
        <div class="e-ptabs"><span>Problems</span><span>Output</span><span class="on">Terminal</span></div>
        <div class="e-term"><div class="e-out"><span class="dim">Checked 214 files in 41ms. No fixes applied.</span></div><div><span class="p">PS C:\\dev\\anyshot&gt;</span> <span class="e-cmd"></span><span class="e-caret"></span></div></div>
      </div>
      <div class="e-status"><span>⎇ main</span><span>⊘ 0  ⚠ 0</span><div class="r"><span>Ln 9, Col 14</span><span>Spaces: 2</span><span>UTF-8</span><span>TypeScript</span></div></div>
    </div>`;
