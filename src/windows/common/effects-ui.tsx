import { BACKGROUNDS } from '../../engine/beautify';
import { type Adjust, type Effects, isAdjustNeutral, NEUTRAL_ADJUST } from '../../engine/model';
import { useStore } from './store';
import { Button, type Controller } from './toolbar';

const PRESETS: { name: string; adjust: Adjust }[] = [
  { name: 'None', adjust: NEUTRAL_ADJUST },
  { name: 'Mono', adjust: { brightness: 0, contrast: 1, saturation: 0, sharpness: 0 } },
  { name: 'Noir', adjust: { brightness: -0.05, contrast: 1.4, saturation: 0, sharpness: 0.3 } },
  { name: 'Fade', adjust: { brightness: 0.08, contrast: 0.8, saturation: 0.75, sharpness: 0 } },
  { name: 'Vivid', adjust: { brightness: 0, contrast: 1.1, saturation: 1.5, sharpness: 0.2 } },
  { name: 'Crisp', adjust: { brightness: 0, contrast: 1.15, saturation: 1.1, sharpness: 0.8 } },
];

const stop = (e: Event) => e.stopPropagation();

/** Invert / Adjust / Beautify buttons for the end of the tool strip. */
export function EffectButtons({ c }: { c: Controller }) {
  const s = useStore(c.store, (s) => ({ effects: s.effects, popover: s.popover }));
  const toggle = (name: 'adjust' | 'beautify') =>
    c.store.set({ popover: s.popover === name ? null : name });
  return (
    <>
      <span class="sep" />
      <Button
        icon="invert"
        label="Invert colours"
        active={s.effects.invert}
        onClick={() => c.effects.set({ ...s.effects, invert: !s.effects.invert })}
        testId="fx-invert"
      />
      <Button
        icon="adjust"
        label="Adjust"
        active={s.popover === 'adjust' || !isAdjustNeutral(s.effects.adjust)}
        expanded={s.popover === 'adjust'}
        onClick={() => toggle('adjust')}
        testId="fx-adjust"
      />
      <Button
        icon="beautify"
        label="Beautify"
        active={s.popover === 'beautify' || s.effects.beautify.enabled}
        expanded={s.popover === 'beautify'}
        onClick={() => toggle('beautify')}
        testId="fx-beautify"
      />
    </>
  );
}

function Range(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onPreview: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  return (
    <label class="opt slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onPreview(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => props.onCommit(Number((e.target as HTMLInputElement).value))}
      />
      <span class="val">{props.value.toFixed(props.step < 1 ? 2 : 0)}</span>
    </label>
  );
}

/** Popover for colour adjustments; sliders preview live and commit once on release. */
export function EffectPopovers({ c }: { c: Controller }) {
  const s = useStore(c.store, (s) => ({
    effects: s.effects,
    popover: s.popover,
    framePreview: s.framePreview,
  }));
  if (s.popover === 'adjust') {
    const fx = s.effects;
    const with_ = (patch: Partial<Adjust>): Effects => ({
      ...fx,
      adjust: { ...fx.adjust, ...patch },
    });
    const slider = (key: keyof Adjust, label: string, min: number, max: number) => (
      <Range
        label={label}
        min={min}
        max={max}
        step={0.01}
        value={fx.adjust[key]}
        onPreview={(v) => c.effects.preview(with_({ [key]: v }))}
        onCommit={(v) => c.effects.set(with_({ [key]: v }))}
      />
    );
    return (
      <div
        class="popover effects"
        role="dialog"
        aria-label="Adjust"
        onPointerDown={stop}
        data-testid="adjust-popover"
      >
        <div class="presets">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.name}
              onClick={() => c.effects.set({ ...fx, adjust: p.adjust })}
            >
              {p.name}
            </button>
          ))}
        </div>
        {slider('brightness', 'Brightness', -0.5, 0.5)}
        {slider('contrast', 'Contrast', 0.5, 2)}
        {slider('saturation', 'Saturation', 0, 2)}
        {slider('sharpness', 'Sharpness', 0, 2)}
      </div>
    );
  }
  if (s.popover === 'beautify') {
    const fx = s.effects;
    const b = fx.beautify;
    const set = (patch: Partial<Effects['beautify']>) =>
      c.effects.set({ ...fx, beautify: { ...b, ...patch } });
    const range = (
      key: 'padding' | 'radius' | 'shadow',
      label: string,
      min: number,
      max: number,
    ) => (
      <Range
        label={label}
        min={min}
        max={max}
        step={1}
        value={b[key]}
        onPreview={(v) => c.effects.preview({ ...fx, beautify: { ...b, [key]: v } })}
        onCommit={(v) => set({ [key]: v })}
      />
    );
    return (
      <div
        class="popover effects"
        role="dialog"
        aria-label="Beautify"
        onPointerDown={stop}
        data-testid="beautify-popover"
      >
        <div class="fx-head">
          <span>Background</span>
          <span class={`fx-state${b.enabled ? ' on' : ''}`} data-testid="beautify-state">
            {b.enabled ? 'On' : 'Off'}
          </span>
        </div>
        {/* "None" sits with the backgrounds: removing the frame is picking no background. */}
        <fieldset class="gradients" aria-label="Background">
          <button
            type="button"
            class={`none${b.enabled ? '' : ' active'}`}
            title="No background"
            aria-label="No background"
            aria-pressed={!b.enabled}
            data-testid="beautify-none"
            onClick={() => set({ enabled: false })}
          />
          {BACKGROUNDS.map(([from, to], i) => {
            const chosen = b.enabled && i === b.background;
            return (
              <button
                type="button"
                key={from}
                class={chosen ? 'active' : ''}
                title={`Background ${i + 1}`}
                aria-label={`Background ${i + 1}`}
                aria-pressed={chosen}
                style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                onClick={() => set({ background: i, enabled: true })}
              />
            );
          })}
        </fieldset>
        <fieldset class="fx-sliders" disabled={!b.enabled} data-testid="beautify-sliders">
          {range('padding', 'Padding', 16, 96)}
          {range('radius', 'Corners', 0, 30)}
          {range('shadow', 'Shadow', 0, 100)}
        </fieldset>
        <span class="opt hint">
          {!b.enabled
            ? 'Pick a background to frame the image.'
            : s.framePreview
              ? 'Shown around the image; applied when you copy, save or pin.'
              : 'Applied when you copy, save or pin.'}
        </span>
      </div>
    );
  }
  return null;
}
