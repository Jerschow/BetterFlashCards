-- Run once in your project's Supabase SQL Editor (safe to re-run).
-- No service-role key is needed by the application. Back up data before schema changes.
begin;

create table if not exists public.user_learning_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.user_learning_state enable row level security;
drop policy if exists "Read your learning state" on public.user_learning_state;
create policy "Read your learning state" on public.user_learning_state for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.user_learning_state from anon, authenticated;
grant select on public.user_learning_state to authenticated;

create table if not exists public.user_entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('mnemonics')),
  expires_at timestamptz,
  primary key (user_id, feature)
);
alter table public.user_entitlements enable row level security;
drop policy if exists "Read your entitlements" on public.user_entitlements;
create policy "Read your entitlements" on public.user_entitlements for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.user_entitlements from anon, authenticated;
grant select on public.user_entitlements to authenticated;

create table if not exists public.ai_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day_start date not null,
  day_count integer not null default 0 check (day_count >= 0),
  minute_start timestamptz not null,
  minute_count integer not null default 0 check (minute_count >= 0)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create or replace function public.save_learning_state(expected_revision bigint, new_snapshot jsonb)
returns table (revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  saved_revision bigint;
  saved_at timestamptz;
begin
  if owner_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if expected_revision is null or expected_revision < 0 then raise exception 'INVALID_REVISION'; end if;
  if new_snapshot is null or jsonb_typeof(new_snapshot) <> 'object' or pg_column_size(new_snapshot) > 8388608 then
    raise exception 'INVALID_SNAPSHOT';
  end if;
  update public.user_learning_state as s set snapshot = new_snapshot, revision = s.revision + 1, updated_at = now()
    where s.user_id = owner_id and s.revision = expected_revision
    returning s.revision, s.updated_at into saved_revision, saved_at;
  if not found and expected_revision = 0 then
    insert into public.user_learning_state as s (user_id, snapshot) values (owner_id, new_snapshot)
      on conflict (user_id) do nothing returning s.revision, s.updated_at into saved_revision, saved_at;
  end if;
  if saved_revision is null then raise exception 'SYNC_CONFLICT'; end if;
  return query select saved_revision, saved_at;
end;
$$;
revoke all on function public.save_learning_state(bigint, jsonb) from public, anon;
grant execute on function public.save_learning_state(bigint, jsonb) to authenticated;

-- The row lock makes both limits atomic across simultaneous requests and app instances.
-- Fixed limits: 30 requests per UTC minute and 200 requests per UTC day, all AI features combined.
create or replace function public.claim_ai_request()
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  current_day date := (now() at time zone 'UTC')::date;
  current_minute timestamptz := date_trunc('minute', now());
  usage_row public.ai_usage%rowtype;
begin
  if owner_id is null then raise exception 'AUTH_REQUIRED'; end if;
  insert into public.ai_usage(user_id, day_start, minute_start) values(owner_id, current_day, current_minute)
    on conflict (user_id) do nothing;
  select * into usage_row from public.ai_usage where user_id = owner_id for update;
  if usage_row.day_start <> current_day then usage_row.day_count := 0; end if;
  if usage_row.minute_start <> current_minute then usage_row.minute_count := 0; end if;
  if usage_row.day_count >= 200 or usage_row.minute_count >= 30 then raise exception 'AI_QUOTA_EXCEEDED'; end if;
  update public.ai_usage set day_start = current_day, minute_start = current_minute,
    day_count = usage_row.day_count + 1, minute_count = usage_row.minute_count + 1 where user_id = owner_id;
end;
$$;
revoke all on function public.claim_ai_request() from public, anon;
grant execute on function public.claim_ai_request() to authenticated;

commit;

-- Optional: grant a TEST account access from the SQL Editor, never from browser code.
-- Replace the UUID with the user's id shown in Authentication > Users.
-- insert into public.user_entitlements(user_id, feature, expires_at)
-- values ('00000000-0000-0000-0000-000000000000', 'mnemonics', null)
-- on conflict (user_id, feature) do update set expires_at = excluded.expires_at;
