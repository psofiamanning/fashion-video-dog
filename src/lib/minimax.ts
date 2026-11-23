// MiniMax H3 image-to-video client (API v2).
// Docs: https://platform.minimax.io/docs/api-reference/video-generation-v2-create
import "server-only";
import { env } from "./env";

const BASE_URL = "https://api.minimax.io/v2";

export type MinimaxStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface MinimaxTask {
  id: string;
  status: MinimaxStatus;
  error?: { code?: string | number; message?: string };
  content?: { url?: string };
  created_at?: number;
  updated_at?: number;
  usage?: unknown;
}

export class MinimaxError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly retryable: boolean) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.minimaxApiKey()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message || `MiniMax request failed (${res.status})`;
    // 429 and 5xx are worth retrying; 400/401/402/422 are not.
    throw new MinimaxError(message, res.status, res.status === 429 || res.status >= 500);
  }
  return body as T;
}

async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof MinimaxError ? err.retryable : true; // network errors
      if (!retryable || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
    }
  }
}

/** Starts an image-to-video task with the dog photo as the first frame. Returns the task id. */
export async function createVideoTask(opts: { prompt: string; firstFrameDataUri: string }): Promise<string> {
  const body = {
    model: env.minimaxModel(),
    resolution: env.minimaxResolution(),
    duration: env.minimaxDuration(),
    generate_audio: true,
    response_format: "flat",
    content: [
      { type: "text", text: opts.prompt },
      { type: "image_url", image_url: { url: opts.firstFrameDataUri }, role: "first_frame" },
    ],
  };
  const res = await withRetries(() =>
    call<{ task_id: string }>("/video_generation", { method: "POST", body: JSON.stringify(body) }),
  );
  return res.task_id;
}

export async function getVideoTask(taskId: string): Promise<MinimaxTask> {
  const res = await withRetries(() =>
    call<MinimaxTask | { task: MinimaxTask }>(`/query/video_generation/${encodeURIComponent(taskId)}`, { method: "GET" }),
  );
  return "task" in res ? res.task : res;
}
