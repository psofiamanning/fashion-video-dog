// Small helper so every step's duration is measured the same way and logged
// as one JSON line per event (easy to grep in Vercel logs).
export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await fn();
  return [result, Math.round(performance.now() - start)];
}

export function logTiming(clipId: string, event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ tag: "clip-timing", clipId, event, ...data }));
}
