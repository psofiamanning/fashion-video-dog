# Dog Video Game

Players upload a dog photo and type an idea; the game turns it into a short video with their dog as the star.

This is the **first slice**: one player, one photo, one MiniMax H3 clip, with every step timed.

## How it works

```
browser ──POST /api/clips (photo + text)──▶ route handler
                                             ├─ upload photo to Supabase Storage  ┐ in parallel
                                             ├─ Claude: dog check + dog profile   ┘ (rejects human faces)
                                             ├─ Claude: write video prompt + moderate player text
                                             └─ MiniMax: create image-to-video task (photo = first frame)
browser ──GET /api/clips/:id every 4 s────▶ checks MiniMax task
                                             ├─ succeeded → copy video into Supabase Storage, return signed URL
                                             └─ failed    → resubmit once, then mark failed
```

MiniMax renders asynchronously and we only ask it for status, so no long-running worker is needed yet:
each poll is a short request that fits on Vercel. If we later add work that runs for minutes on our side
(e.g. stitching both players' clips), `advanceClip()` in `src/lib/pipeline.ts` is the function a worker or cron would call.

### Code map

| File | What it does |
|---|---|
| `src/lib/claude.ts` | Dog photo check (vision, structured output) and the prompt writer |
| `src/lib/minimax.ts` | MiniMax H3 v2 API: create task, query task, retries on 429/5xx |
| `src/lib/pipeline.ts` | `createClip()` and `advanceClip()`: the whole flow, free of HTTP details |
| `src/lib/db.ts` | Supabase client and `clips` table helpers |
| `src/lib/timing.ts` | Step timing and JSON log lines (`"tag":"clip-timing"`) |
| `src/app/api/clips/*` | Thin route handlers |
| `src/app/page.tsx` | Upload form, live timer, video reveal, timing table |
| `supabase/migrations/0001_clips.sql` | `clips` table and the two private storage buckets |

## Render-time measurement

Each clip stores `timings` (also logged as one JSON line per step):
`dog_check_ms`, `prompt_ms`, `render_ms` (MiniMax submit → succeeded, from MiniMax's own timestamps when present),
`store_ms`, and `total_ms` (request received → video saved). The page shows them under the video.

To compare runs: `select timings, minimax_model, attempts from clips where status = 'succeeded' order by created_at desc;`

## Setup

1. `npm install`
2. Create a Supabase project, open the SQL editor, and run `supabase/migrations/0001_clips.sql`.
3. `cp .env.example .env.local` and fill in:
   - `ANTHROPIC_API_KEY` from console.anthropic.com
   - `MINIMAX_API_KEY` from platform.minimax.io (Account Management > API Keys), with credit loaded
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Supabase Project Settings > API
4. `npm run dev` and open http://localhost:3000

On Vercel: import the repo and add the same variables under Project Settings > Environment Variables.

## Costs per clip (approx.)

MiniMax H3 768p is about $0.08 per second of video, so a 6-second clip is about $0.48. The two Claude calls are a few cents.
Set `MINIMAX_MODEL=MiniMax-H3-Lite` or `MiniMax-H3-Highspeed` for cheaper test runs.

## Ready for the 2-player lobby

`clips` already has `session_id` and `player_slot`, and `createClip()` accepts them. The lobby adds a
`game_sessions` table, a join code, and Supabase Realtime on `clips` so both players see each other's reveal.
