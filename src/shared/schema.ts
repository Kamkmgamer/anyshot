/**
 * A tiny schema DSL for settings and other persisted JSON. Every field has a
 * default and a parser; parsing never throws, invalid values fall back to the
 * default so a hand-edited or older settings file can't break startup.
 */
export interface Field<T> {
  readonly def: T;
  parse(value: unknown): T;
}

export type Infer<F> = F extends Field<infer T> ? T : never;

export const bool = (def: boolean): Field<boolean> => ({
  def,
  parse: (v) => (typeof v === 'boolean' ? v : def),
});

export const int = (def: number, min: number, max: number): Field<number> => ({
  def,
  parse: (v) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def,
});

export const num = (def: number, min: number, max: number): Field<number> => ({
  def,
  parse: (v) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def,
});

export const str = (def: string, maxLength = 2048): Field<string> => ({
  def,
  parse: (v) => (typeof v === 'string' && v.length <= maxLength ? v : def),
});

export const oneOf = <const T extends readonly string[]>(
  values: T,
  def: T[number],
): Field<T[number]> => ({
  def,
  parse: (v) => (typeof v === 'string' && values.includes(v) ? (v as T[number]) : def),
});

export const pattern = (def: string, re: RegExp): Field<string> => ({
  def,
  parse: (v) => (typeof v === 'string' && re.test(v) ? v : def),
});

export const list = <T>(item: Field<T>, def: T[], maxItems: number): Field<T[]> => ({
  def,
  parse: (v) => (Array.isArray(v) ? v.slice(0, maxItems).map((x) => item.parse(x)) : def),
});

type Shape = Record<string, Field<unknown>>;
type ObjectOf<S extends Shape> = { [K in keyof S]: Infer<S[K]> };

export const obj = <S extends Shape>(shape: S): Field<ObjectOf<S>> => {
  const def = Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [key, field.def]),
  ) as ObjectOf<S>;
  return {
    def,
    parse: (v) => {
      const input = isRecord(v) ? v : {};
      return Object.fromEntries(
        Object.entries(shape).map(([key, field]) => [key, field.parse(input[key])]),
      ) as ObjectOf<S>;
    },
  };
};

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merges a partial patch into a value; arrays and primitives are replaced. */
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isRecord(base) || !isRecord(patch)) return patch === undefined ? base : (patch as T);
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = key in base ? mergeDeep((base as Record<string, unknown>)[key], value) : value;
  }
  return out as T;
}
