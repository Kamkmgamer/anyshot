import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { sortedStops } from '../../engine/background-render';
import {
  BLENDS,
  type CustomBackground,
  GRADIENT_TYPES,
  type GradientBackground,
  IMAGE_FITS,
  MAX_GRADIENT_COLORS,
  PATTERNS,
} from '../../shared/background';
import { paintBackgroundPreview } from './background-preview';

export function BackgroundCanvas({
  background,
  large = false,
}: {
  background: CustomBackground;
  large?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (large) {
      paintBackgroundPreview(canvas, background, 640, 300);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      paintBackgroundPreview(canvas, background, 112, 64);
      observer.disconnect();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [background, large]);
  return <canvas ref={ref} width={large ? 640 : 112} height={large ? 300 : 64} />;
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label class="bg-field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => {
          const option = options.find((option) => option === e.currentTarget.value);
          if (option !== undefined) onChange(option);
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option[0]?.toUpperCase()}
            {option.slice(1).replace('-', ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}

function Slider({
  label,
  value,
  max = 100,
  min = 0,
  suffix = '%',
  onChange,
}: {
  label: string;
  value: number;
  max?: number;
  min?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label class="bg-field bg-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onInput={(e) => onChange(e.currentTarget.valueAsNumber)}
      />
      <span aria-hidden="true">
        {value}
        {suffix}
      </span>
    </label>
  );
}

function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div class="bg-field bg-color">
      <span>{label}</span>
      <input
        type="color"
        aria-label={`${label} picker`}
        value={value}
        onInput={(e) => {
          setText(null);
          onChange(e.currentTarget.value);
        }}
      />
      <input
        type="text"
        aria-label={`${label} hex`}
        value={text ?? value}
        maxLength={7}
        spellcheck={false}
        onInput={(e) => {
          const next = e.currentTarget.value;
          setText(next);
          if (/^#[\da-f]{6}$/i.test(next)) onChange(next);
        }}
        onBlur={() => setText(null)}
      />
    </div>
  );
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function Handle({
  label,
  x,
  y,
  color,
  selected,
  onSelect,
  onMove,
}: {
  label: string;
  x: number;
  y?: number;
  color: string;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}) {
  return (
    <button
      type="button"
      class="bg-handle"
      aria-label={label}
      aria-pressed={selected}
      style={{ left: `${x}%`, top: `${y ?? 50}%`, background: color }}
      onClick={onSelect}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        onSelect();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const button = e.currentTarget;
        const bounds = button.parentElement?.getBoundingClientRect();
        if (!bounds || !button.hasPointerCapture(e.pointerId)) return;
        onMove(
          clamp(((e.clientX - bounds.left) / bounds.width) * 100),
          clamp(((e.clientY - bounds.top) / bounds.height) * 100),
        );
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (dx === 0 && (dy === 0 || y === undefined)) return;
        e.preventDefault();
        onMove(clamp(x + dx), clamp((y ?? 50) + dy));
      }}
    />
  );
}

function GradientDesigner({
  value,
  onChange,
}: {
  value: GradientBackground;
  onChange: (value: GradientBackground) => void;
}) {
  const [selection, setSelection] = useState(0);
  const patch = (change: Partial<GradientBackground>) => onChange({ ...value, ...change });
  const pattern = (change: Partial<GradientBackground['pattern']>) =>
    patch({ pattern: { ...value.pattern, ...change } });
  const isMesh = value.type === 'mesh';
  const hasCenter = value.type === 'radial' || value.type === 'conic';
  const colors = isMesh ? value.points : value.stops;
  const selected = Math.min(selection, colors.length - 1);
  const stop = value.stops[selected];
  const point = value.points[selected];
  const movePoint = (index: number, change: Partial<GradientBackground['points'][number]>) =>
    patch({
      points: value.points.map((point, i) => (i === index ? { ...point, ...change } : point)),
    });
  const moveStop = (index: number, change: Partial<GradientBackground['stops'][number]>) =>
    patch({ stops: value.stops.map((stop, i) => (i === index ? { ...stop, ...change } : stop)) });
  const add = () => {
    const color = colors[selected]?.color ?? '#ffffff';
    if (isMesh) {
      patch({ points: [...value.points, { color, x: 50, y: 50 }] });
    } else {
      const positions = [0, ...sortedStops(value.stops).map(({ position }) => position), 100];
      let gap = 0;
      let middle = 50;
      for (let i = 1; i < positions.length; i++) {
        const right = positions[i] ?? 100;
        const left = positions[i - 1] ?? 0;
        if (right - left > gap) {
          gap = right - left;
          middle = (left + right) / 2;
        }
      }
      patch({ stops: [...value.stops, { color, position: Math.round(middle) }] });
    }
    setSelection(colors.length);
  };
  const remove = () => {
    if (isMesh) patch({ points: value.points.filter((_, i) => i !== selected) });
    else patch({ stops: value.stops.filter((_, i) => i !== selected) });
    setSelection(Math.max(0, selected - 1));
  };
  const name = isMesh ? 'point' : 'stop';
  return (
    <>
      <div class="bg-preview">
        <BackgroundCanvas background={value} large />
        {isMesh &&
          value.points.map(({ x, y, color }, i) => (
            <Handle
              key={i}
              label={`Color point ${i + 1}`}
              x={x}
              y={y}
              color={color}
              selected={selected === i}
              onSelect={() => setSelection(i)}
              onMove={(x, y) => movePoint(i, { x, y })}
            />
          ))}
        {hasCenter && (
          <Handle
            label="Gradient center"
            x={value.x}
            y={value.y}
            color="transparent"
            selected={false}
            onSelect={() => undefined}
            onMove={(x, y) => patch({ x, y })}
          />
        )}
      </div>
      <div class="bg-columns">
        <Choice
          label="Gradient type"
          value={value.type}
          options={GRADIENT_TYPES}
          onChange={(type) => {
            setSelection(0);
            patch({ type });
          }}
        />
        {(value.type === 'linear' || value.type === 'conic') && (
          <Slider
            label="Angle"
            value={value.angle}
            max={360}
            suffix="°"
            onChange={(angle) => patch({ angle })}
          />
        )}
        {isMesh && (
          <Slider
            label="Softness"
            value={value.softness}
            onChange={(softness) => patch({ softness })}
          />
        )}
      </div>
      {!isMesh && (
        <div
          class="bg-stop-track"
          style={{
            background: `linear-gradient(90deg, ${sortedStops(value.stops)
              .map(({ color, position }) => `${color} ${position}%`)
              .join(', ')})`,
          }}
        >
          {value.stops.map(({ position, color }, i) => (
            <Handle
              key={i}
              label={`Color stop ${i + 1}`}
              x={position}
              color={color}
              selected={selected === i}
              onSelect={() => setSelection(i)}
              onMove={(position) => moveStop(i, { position })}
            />
          ))}
        </div>
      )}
      <div class="bg-color-editor">
        <label class="bg-field">
          <span>Color {name}</span>
          <select value={selected} onChange={(e) => setSelection(Number(e.currentTarget.value))}>
            {colors.map((_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <Color
          key={`${name}-${selected}`}
          label="Color"
          value={colors[selected]?.color ?? '#ffffff'}
          onChange={(color) =>
            isMesh ? movePoint(selected, { color }) : moveStop(selected, { color })
          }
        />
        <button
          class="bg-button"
          type="button"
          disabled={colors.length >= MAX_GRADIENT_COLORS}
          onClick={add}
        >
          Add {name}
        </button>
        <button class="bg-button" type="button" disabled={colors.length <= 2} onClick={remove}>
          Remove
        </button>
      </div>
      {!isMesh && stop && (
        <Slider
          label="Stop position"
          value={stop.position}
          onChange={(position) => moveStop(selected, { position })}
        />
      )}
      {isMesh && point && (
        <div class="bg-columns">
          <Slider label="Point X" value={point.x} onChange={(x) => movePoint(selected, { x })} />
          <Slider label="Point Y" value={point.y} onChange={(y) => movePoint(selected, { y })} />
        </div>
      )}
      <div class="bg-texture bg-columns">
        <Choice
          label="Pattern"
          value={value.pattern.type}
          options={PATTERNS}
          onChange={(type) => pattern({ type })}
        />
        <Slider label="Grain" value={value.grain} onChange={(grain) => patch({ grain })} />
        {value.pattern.type !== 'none' && (
          <>
            <Choice
              label="Blend mode"
              value={value.pattern.blend}
              options={BLENDS}
              onChange={(blend) => pattern({ blend })}
            />
            <Color
              label="Pattern color"
              value={value.pattern.color}
              onChange={(color) => pattern({ color })}
            />
            <Slider
              label="Opacity"
              value={value.pattern.opacity}
              onChange={(opacity) => pattern({ opacity })}
            />
            <Slider
              label="Scale"
              value={value.pattern.scale}
              min={8}
              onChange={(scale) => pattern({ scale })}
            />
            <Slider
              label="Rotation"
              value={value.pattern.angle}
              max={360}
              suffix="°"
              onChange={(angle) => pattern({ angle })}
            />
          </>
        )}
      </div>
    </>
  );
}

export function BackgroundDesigner({
  value,
  onChange,
}: {
  value: CustomBackground;
  onChange: (value: CustomBackground) => void;
}) {
  if (value.kind === 'gradient') return <GradientDesigner value={value} onChange={onChange} />;
  return (
    <>
      <div class="bg-preview">
        <BackgroundCanvas background={value} large />
      </div>
      <div class="bg-columns">
        <Choice
          label="Image fit"
          value={value.fit}
          options={IMAGE_FITS}
          onChange={(fit) => onChange({ ...value, fit })}
        />
        <Color
          label="Matte"
          value={value.matte}
          onChange={(matte) => onChange({ ...value, matte })}
        />
        <Slider label="Position X" value={value.x} onChange={(x) => onChange({ ...value, x })} />
        <Slider label="Position Y" value={value.y} onChange={(y) => onChange({ ...value, y })} />
      </div>
    </>
  );
}
