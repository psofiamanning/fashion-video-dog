import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

export const PHOTO_BUCKET = "dog-photos";
export const CLIP_BUCKET = "clips";

export type ClipStatus = "rendering" | "succeeded" | "failed" | "rejected";

export interface Timings {
  received_at?: string;
  photo_upload_ms?: number;
  dog_check_ms?: number;
  prompt_ms?: number;
  submitted_at?: string;     // when the MiniMax task was created (latest attempt)
  render_ms?: number;        // MiniMax: submit -> succeeded (latest attempt)
  store_ms?: number;         // download from MiniMax + upload to storage
  total_ms?: number;         // request received -> video stored
}

export interface ClipRow {
  id: string;
  created_at: string;
  session_id: string | null;
  player_slot: number | null;
  status: ClipStatus;
  player_text: string;
  photo_path: string;
  dog_profile: unknown;
  video_prompt: string | null;
  minimax_model: string | null;
  minimax_task_id: string | null;
  attempts: number;
  video_path: string | null;
  error: string | null;
  timings: Timings;
}

let cached: SupabaseClient | null = null;
export function db(): SupabaseClient {
  cached ??= createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
  return cached;
}

export async function insertClip(row: Partial<ClipRow>): Promise<ClipRow> {
  const { data, error } = await db().from("clips").insert(row).select().single();
  if (error) throw error;
  return data as ClipRow;
}

export async function updateClip(id: string, patch: Partial<ClipRow>): Promise<ClipRow> {
  const { data, error } = await db()
    .from("clips")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as ClipRow;
}

export async function getClip(id: string): Promise<ClipRow | null> {
  const { data, error } = await db().from("clips").select().eq("id", id).maybeSingle();
  if (error) throw error;
  return data as ClipRow | null;
}

export async function signedUrl(bucket: string, path: string, seconds = 3600): Promise<string> {
  const { data, error } = await db().storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}
