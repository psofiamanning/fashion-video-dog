"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicClip } from "./api/clips/view";

const POLL_MS = 4000;

function seconds(ms?: number) {
  return ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`;
}

export default function Home() {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<PublicClip | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!photo) return setPreview(null);
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // Live elapsed-time counter while waiting.
  useEffect(() => {
    if (!startedAt || clip?.status === "succeeded" || clip?.status === "failed" || clip?.status === "rejected") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [startedAt, clip?.status]);

  // Poll the server while the video renders.
  useEffect(() => {
    if (clip?.status !== "rendering") return;
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clips/${clip.id}`, { cache: "no-store" });
        if (res.ok) setClip(await res.json());
        else setClip({ ...clip }); // keep polling
      } catch {
        setClip({ ...clip });
      }
    }, POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [clip]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo || !text.trim()) return;
    setSubmitting(true);
    setError(null);
    setClip(null);
    setStartedAt(Date.now());
    try {
      const form = new FormData();
      form.append("photo", photo);
      form.append("text", text);
      const res = await fetch("/api/clips", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Something went wrong.");
      setClip(body);
    } catch (err) {
      setError((err as Error).message);
      setStartedAt(null);
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || clip?.status === "rendering";
  const elapsed = startedAt ? now - startedAt : 0;

  return (
    <main>
      <h1>Your dog, the movie star</h1>
      <p className="muted">Upload a photo of your dog, say what happens, and get a short video back.</p>

      <form className="card" onSubmit={submit}>
        <label htmlFor="photo">Dog photo</label>
        <input
          id="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
        {preview && <img src={preview} alt="Your dog" className="preview" />}

        <label htmlFor="text" style={{ marginTop: 16 }}>What does your dog do?</label>
        <textarea
          id="text"
          maxLength={500}
          placeholder="My dog surfs a giant wave wearing sunglasses"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={busy || !photo || !text.trim()}>
            {submitting ? "Checking photo…" : clip?.status === "rendering" ? "Rendering…" : "Make my video"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>

      {(busy || clip) && (
        <section className="card">
          {busy && <p>Working on it… {seconds(elapsed)}</p>}
          {clip?.status === "rendering" && clip.attempts > 1 && <p className="muted">Retrying (attempt {clip.attempts}).</p>}
          {(clip?.status === "rejected" || clip?.status === "failed") && <p className="error">{clip.error}</p>}
          {clip?.videoUrl && <video src={clip.videoUrl} controls autoPlay playsInline />}

          {clip && (
            <table style={{ marginTop: 12 }}>
              <tbody>
                <tr><td>Photo check (Claude)</td><td>{seconds(clip.timings.dog_check_ms)}</td></tr>
                <tr><td>Prompt writing (Claude)</td><td>{seconds(clip.timings.prompt_ms)}</td></tr>
                <tr><td>Video render (MiniMax)</td><td>{seconds(clip.timings.render_ms)}</td></tr>
                <tr><td>Saving video</td><td>{seconds(clip.timings.store_ms)}</td></tr>
                <tr><td><strong>Total</strong></td><td><strong>{seconds(clip.timings.total_ms)}</strong></td></tr>
              </tbody>
            </table>
          )}
          {clip?.videoPrompt && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted">Prompt sent to the video model</summary>
              <p>{clip.videoPrompt}</p>
            </details>
          )}
        </section>
      )}
    </main>
  );
}
