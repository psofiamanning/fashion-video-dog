-- First slice: one player, one photo, one clip.
-- session_id / player_slot are reserved for the 2-player lobby later.

create table if not exists public.clips (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  session_id       uuid,                 -- future: references game_sessions(id)
  player_slot      smallint,             -- future: 1 or 2
  status           text not null check (status in ('rendering', 'succeeded', 'failed', 'rejected')),
  player_text      text not null,
  photo_path       text not null,        -- object path in the dog-photos bucket
  dog_profile      jsonb,
  video_prompt     text,
  minimax_model    text,
  minimax_task_id  text,
  attempts         smallint not null default 0,
  video_path       text,                 -- object path in the clips bucket
  error            text,
  timings          jsonb not null default '{}'::jsonb
);

create index if not exists clips_session_idx on public.clips (session_id);

-- Only the server (service role) touches this table for now.
alter table public.clips enable row level security;

-- Private buckets; the app hands out short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('dog-photos', 'dog-photos', false), ('clips', 'clips', false)
on conflict (id) do nothing;
