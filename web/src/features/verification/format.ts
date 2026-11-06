// Numbers on the verification and request-log screens, written the same way everywhere.

export const usd = (n: number | null | undefined): string =>
  n == null ? "—" : n === 0 ? "$0.00" : n < 0.1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

export const tokens = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString("en-US"));

/** "20 s", "1.5 min", "2 h 10 min". */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} min`;
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
}

export const millis = (ms: number | null | undefined): string => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** A catalog price per million tokens. */
export const pricePerM = (n: number | null | undefined): string => (n == null ? "—" : n === 0 ? "free" : `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`);

/** The two forms of a payload (F-096): readable is indented, raw is exactly one line as it was stored. */
export const readableJson = (value: unknown): string => JSON.stringify(value, null, 2) ?? "";
export const rawJson = (value: unknown): string => JSON.stringify(value) ?? "";
