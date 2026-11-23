// The clip pipeline: photo -> dog check -> prompt -> MiniMax -> stored video.
// Kept free of HTTP details so the 2-player lobby can call the same functions
// for each player later.
import "server-only";
import { randomUUID } from "node:crypto";
import { checkDogPhoto, photoRejection, writeVideoPrompt, type ImageMediaType } from "./claude";
import { createVideoTask, getVideoTask } from "./minimax";
import { CLIP_BUCKET, PHOTO_BUCKET, db, getClip, insertClip, updateClip, type ClipRow, type Timings } from "./db";
import { env } from "./env";
import { logTiming, timed } from "./timing";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // Claude's per-image limit
export const MAX_TEXT_CHARS = 500;
const MAX_ATTEMPTS = 2; // MiniMax task resubmits after a failed render
const RENDER_TIMEOUT_MS = 15 * 60 * 1000;
const ALLOWED_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/webp"];

export class InputError extends Error {}

export interface NewClipInput {
  photo: File;
  text: string;
  sessionId?: string | null;
  playerSlot?: number | null;
}

export async function createClip(input: NewClipInput): Promise<ClipRow> {
  const text = input.text.trim();
  if (!text) throw new InputError("Tell us what your dog should do.");
  if (text.length > MAX_TEXT_CHARS) throw new InputError(`Keep it under ${MAX_TEXT_CHARS} characters.`);
  const mediaType = input.photo.type as ImageMediaType;
  if (!ALLOWED_TYPES.includes(mediaType)) throw new InputError("Use a JPG, PNG or WEBP photo.");
  if (input.photo.size > MAX_PHOTO_BYTES) throw new InputError("That photo is over 5 MB. Try a smaller one.");

  const receivedAt = new Date();
  const timings: Timings = { received_at: receivedAt.toISOString() };
  const clipId = randomUUID();
  const bytes = Buffer.from(await input.photo.arrayBuffer());
  const base64 = bytes.toString("base64");
  const ext = mediaType.split("/")[1];
  const photoPath = `${clipId}.${ext}`;
  const base: Partial<ClipRow> = {
    id: clipId,
    session_id: input.sessionId ?? null,
    player_slot: input.playerSlot ?? null,
    player_text: text,
    photo_path: photoPath,
    timings,
  };

  // Upload and the dog check run in parallel; both need only the raw photo.
  const [[uploadResult, uploadMs], [check, checkMs]] = await Promise.all([
    timed(() => db().storage.from(PHOTO_BUCKET).upload(photoPath, bytes, { contentType: mediaType })),
    timed(() => checkDogPhoto(base64, mediaType)),
  ]);
  if (uploadResult.error) throw uploadResult.error;
  timings.photo_upload_ms = uploadMs;
  timings.dog_check_ms = checkMs;
  logTiming(clipId, "dog_check", { ms: checkMs, upload_ms: uploadMs });

  const rejection = photoRejection(check);
  if (rejection) {
    return insertClip({ ...base, status: "rejected", dog_profile: check, error: rejection });
  }

  const duration = env.minimaxDuration();
  const [prompt, promptMs] = await timed(() => writeVideoPrompt(text, check.profile, duration));
  timings.prompt_ms = promptMs;
  logTiming(clipId, "prompt", { ms: promptMs, allowed: prompt.allowed });
  if (!prompt.allowed) {
    return insertClip({
      ...base,
      status: "rejected",
      dog_profile: check.profile,
      error: prompt.moderation_reason || "Try a different idea.",
    });
  }

  try {
    const taskId = await createVideoTask({
      prompt: prompt.video_prompt,
      firstFrameDataUri: `data:${mediaType};base64,${base64}`,
    });
    timings.submitted_at = new Date().toISOString();
    logTiming(clipId, "minimax_submitted", { taskId, model: env.minimaxModel() });
    return insertClip({
      ...base,
      status: "rendering",
      dog_profile: check.profile,
      video_prompt: prompt.video_prompt,
      minimax_model: env.minimaxModel(),
      minimax_task_id: taskId,
      attempts: 1,
    });
  } catch (err) {
    return insertClip({
      ...base,
      status: "failed",
      dog_profile: check.profile,
      video_prompt: prompt.video_prompt,
      error: `Video service error: ${(err as Error).message}`,
    });
  }
}

/**
 * Moves a rendering clip forward: checks MiniMax, stores the finished video,
 * or resubmits a failed render. Safe to call repeatedly (it's what polling does).
 */
export async function advanceClip(id: string): Promise<ClipRow | null> {
  const clip = await getClip(id);
  if (!clip || clip.status !== "rendering" || !clip.minimax_task_id) return clip;

  const task = await getVideoTask(clip.minimax_task_id);
  const submittedAt = clip.timings.submitted_at ? Date.parse(clip.timings.submitted_at) : Date.now();

  if (task.status === "succeeded" && task.content?.url) {
    // Prefer MiniMax's own timestamps; fall back to our wall clock (poll-interval accuracy).
    const renderMs =
      task.created_at && task.updated_at ? (task.updated_at - task.created_at) * 1000 : Date.now() - submittedAt;
    const [, storeMs] = await timed(async () => {
      const video = await fetch(task.content!.url!, { cache: "no-store" });
      if (!video.ok) throw new Error(`Couldn't download the video (${video.status}).`);
      const buf = Buffer.from(await video.arrayBuffer());
      const { error } = await db()
        .storage.from(CLIP_BUCKET)
        .upload(`${clip.id}.mp4`, buf, { contentType: "video/mp4", upsert: true });
      if (error) throw error;
    });
    const totalMs = Date.now() - Date.parse(clip.timings.received_at ?? clip.created_at);
    const timings = { ...clip.timings, render_ms: renderMs, store_ms: storeMs, total_ms: totalMs };
    logTiming(clip.id, "succeeded", { render_ms: renderMs, store_ms: storeMs, total_ms: totalMs, attempts: clip.attempts });
    return updateClip(clip.id, { status: "succeeded", video_path: `${clip.id}.mp4`, timings });
  }

  const timedOut = Date.now() - submittedAt > RENDER_TIMEOUT_MS;
  if (task.status === "failed" || task.status === "cancelled" || timedOut) {
    const reason = timedOut ? "Render took too long." : task.error?.message || `Render ${task.status}.`;
    logTiming(clip.id, "render_failed", { reason, attempts: clip.attempts });
    if (clip.attempts < MAX_ATTEMPTS && !timedOut) return resubmit(clip, reason);
    return updateClip(clip.id, { status: "failed", error: reason });
  }

  return clip; // still queued or running
}

async function resubmit(clip: ClipRow, previousError: string): Promise<ClipRow> {
  const { data, error } = await db().storage.from(PHOTO_BUCKET).download(clip.photo_path);
  if (error) throw error;
  const base64 = Buffer.from(await data.arrayBuffer()).toString("base64");
  const taskId = await createVideoTask({
    prompt: clip.video_prompt!,
    firstFrameDataUri: `data:${data.type || "image/jpeg"};base64,${base64}`,
  });
  // Only the poll that still sees the old task id wins, so two polls can't both resubmit.
  const { data: updated, error: updateError } = await db()
    .from("clips")
    .update({
      minimax_task_id: taskId,
      attempts: clip.attempts + 1,
      error: `Retrying after: ${previousError}`,
      timings: { ...clip.timings, submitted_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", clip.id)
    .eq("minimax_task_id", clip.minimax_task_id!)
    .select()
    .maybeSingle();
  if (updateError) throw updateError;
  logTiming(clip.id, "minimax_resubmitted", { taskId, attempt: clip.attempts + 1 });
  return (updated as ClipRow | null) ?? (await getClip(clip.id))!;
}
