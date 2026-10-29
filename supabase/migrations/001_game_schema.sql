-- Redesign the Last Mile: Datenbank für den Online-Mehrspielermodus.
-- Spielende lesen Tabellen direkt; geschrieben wird nur über geprüfte Funktionen (security definer).

create table public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  status text not null default 'lobby' check (status in ('lobby', 'running', 'finished')),
  seed bigint not null,
  rounds int not null check (rounds between 4 and 6),
  config_version text not null,
  team_count int,
  current_round int not null default 1,
  round_started_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);

create table public.teams (
  game_id uuid not null references public.games (id) on delete cascade,
  slot int not null check (slot between 0 and 4),
  name text not null,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (game_id, slot),
  unique (game_id, user_id)
);

create table public.actions (
  game_id uuid not null references public.games (id) on delete cascade,
  round int not null,
  slot int not null,
  actions jsonb not null,
  user_id uuid,
  submitted_at timestamptz not null default now(),
  primary key (game_id, round, slot)
);

-- Öffentlicher Abgabestatus ohne Inhalt der Aktionen
create table public.submissions (
  game_id uuid not null references public.games (id) on delete cascade,
  round int not null,
  slot int not null,
  submitted_at timestamptz not null default now(),
  primary key (game_id, round, slot)
);

create table public.results (
  game_id uuid primary key references public.games (id) on delete cascade,
  summary jsonb not null,
  created_at timestamptz not null default now()
);

create index on public.games (status, finished_at desc);

alter table public.games enable row level security;
alter table public.teams enable row level security;
alter table public.actions enable row level security;
alter table public.submissions enable row level security;
alter table public.results enable row level security;

create policy "games lesbar" on public.games for select to authenticated using (true);
create policy "teams lesbar" on public.teams for select to authenticated using (true);
create policy "submissions lesbar" on public.submissions for select to authenticated using (true);
create policy "results lesbar" on public.results for select to authenticated using (true);
-- Aktionen anderer Teams erst nach Abschluss der Runde sichtbar
create policy "actions lesbar nach Runde" on public.actions for select to authenticated using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.games g
    where g.id = actions.game_id and (g.status = 'finished' or actions.round < g.current_round)
  )
);

-- Spiel eröffnen
create or replace function public.create_game(p_rounds int, p_config_version text)
returns public.games
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
  v_game public.games;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  if p_rounds not between 4 and 6 then raise exception 'ungültige Rundenzahl'; end if;
  loop
    v_code := '';
    for i in 1..3 loop v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1); end loop;
    v_code := v_code || '-' || lpad(floor(random() * 100)::int::text, 2, '0');
    exit when not exists (select 1 from public.games where code = v_code);
  end loop;
  insert into public.games (code, created_by, seed, rounds, config_version)
  values (v_code, auth.uid(), floor(random() * 2147483647)::bigint, p_rounds, p_config_version)
  returning * into v_game;
  insert into public.teams (game_id, slot, name, user_id)
  values (v_game.id, 0, 'Alpenkurier', auth.uid());
  return v_game;
end;
$$;

-- Mit Code beitreten (oder zurückkehren)
create or replace function public.join_game(p_code text)
returns public.teams
language plpgsql security definer set search_path = ''
as $$
declare
  v_game public.games;
  v_team public.teams;
  v_names text[] := array['Alpenkurier', 'Paketfalke', 'Kurierwerk', 'Talexpress', 'Nordlicht Logistik'];
  v_slot int;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  select * into v_game from public.games where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Spiel nicht gefunden'; end if;
  select * into v_team from public.teams where game_id = v_game.id and user_id = auth.uid();
  if found then return v_team; end if;
  if v_game.status <> 'lobby' then raise exception 'Spiel läuft bereits'; end if;
  select min(s) into v_slot from generate_series(0, 4) s
  where not exists (select 1 from public.teams t where t.game_id = v_game.id and t.slot = s);
  if v_slot is null then raise exception 'Spiel ist voll'; end if;
  insert into public.teams (game_id, slot, name, user_id)
  values (v_game.id, v_slot, v_names[v_slot + 1], auth.uid())
  returning * into v_team;
  return v_team;
end;
$$;

-- Spiel starten (nur wer es eröffnet hat)
create or replace function public.start_game(p_game uuid)
returns public.games
language plpgsql security definer set search_path = ''
as $$
declare
  v_game public.games;
  v_count int;
begin
  select * into v_game from public.games where id = p_game for update;
  if not found then raise exception 'Spiel nicht gefunden'; end if;
  if v_game.created_by <> auth.uid() then raise exception 'nur das eröffnende Team kann starten'; end if;
  if v_game.status <> 'lobby' then raise exception 'Spiel läuft bereits'; end if;
  -- Slots sind lückenlos 0..n-1, weil Teams nur beitreten und nie austreten
  select count(*) into v_count from public.teams where game_id = p_game;
  update public.games
  set status = 'running', team_count = v_count, started_at = now(), round_started_at = now(), current_round = 1
  where id = p_game returning * into v_game;
  return v_game;
end;
$$;

-- Aktionen abgeben; wenn alle abgegeben haben, beginnt die nächste Runde
create or replace function public.submit_actions(p_game uuid, p_round int, p_actions jsonb)
returns public.games
language plpgsql security definer set search_path = ''
as $$
declare
  v_game public.games;
  v_slot int;
  v_count int;
begin
  select * into v_game from public.games where id = p_game for update;
  if not found then raise exception 'Spiel nicht gefunden'; end if;
  if v_game.status <> 'running' then raise exception 'Spiel läuft nicht'; end if;
  if p_round <> v_game.current_round then raise exception 'falsche Runde'; end if;
  if jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) > 2 then raise exception 'ungültige Aktionen'; end if;
  select slot into v_slot from public.teams where game_id = p_game and user_id = auth.uid();
  if v_slot is null then raise exception 'kein Team in diesem Spiel'; end if;
  insert into public.actions (game_id, round, slot, actions, user_id)
  values (p_game, p_round, v_slot, p_actions, auth.uid())
  on conflict do nothing;
  if not found then raise exception 'bereits abgegeben'; end if;
  insert into public.submissions (game_id, round, slot) values (p_game, p_round, v_slot) on conflict do nothing;
  select count(*) into v_count from public.actions where game_id = p_game and round = p_round;
  if v_count >= v_game.team_count then
    if v_game.current_round >= v_game.rounds then
      update public.games set status = 'finished', finished_at = now(), current_round = v_game.rounds + 1
      where id = p_game returning * into v_game;
    else
      update public.games set current_round = current_round + 1, round_started_at = now()
      where id = p_game returning * into v_game;
    end if;
  end if;
  return v_game;
end;
$$;

-- Nach Ablauf der Rundenzeit: fehlende Teams geben automatisch «keine Aktion» ab
create or replace function public.skip_missing(p_game uuid, p_minutes int default 5)
returns public.games
language plpgsql security definer set search_path = ''
as $$
declare
  v_game public.games;
  v_slot int;
begin
  select * into v_game from public.games where id = p_game for update;
  if not found or v_game.status <> 'running' then raise exception 'Spiel läuft nicht'; end if;
  if not exists (select 1 from public.teams where game_id = p_game and user_id = auth.uid()) then raise exception 'kein Team in diesem Spiel'; end if;
  if v_game.round_started_at > now() - make_interval(mins => greatest(p_minutes, 1)) then raise exception 'Rundenzeit noch nicht abgelaufen'; end if;
  for v_slot in select slot from public.teams t where t.game_id = p_game
    and not exists (select 1 from public.actions a where a.game_id = p_game and a.round = v_game.current_round and a.slot = t.slot)
  loop
    insert into public.actions (game_id, round, slot, actions, user_id) values (p_game, v_game.current_round, v_slot, '[]'::jsonb, null);
    insert into public.submissions (game_id, round, slot) values (p_game, v_game.current_round, v_slot) on conflict do nothing;
  end loop;
  if v_game.current_round >= v_game.rounds then
    update public.games set status = 'finished', finished_at = now(), current_round = v_game.rounds + 1 where id = p_game returning * into v_game;
  else
    update public.games set current_round = current_round + 1, round_started_at = now() where id = p_game returning * into v_game;
  end if;
  return v_game;
end;
$$;

-- Zusammenfassung eines beendeten Spiels speichern (erster Schreiber gewinnt)
create or replace function public.save_result(p_game uuid, p_summary jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.games where id = p_game and status = 'finished') then raise exception 'Spiel nicht beendet'; end if;
  if not exists (select 1 from public.teams where game_id = p_game and user_id = auth.uid()) then raise exception 'kein Team in diesem Spiel'; end if;
  insert into public.results (game_id, summary) values (p_game, p_summary) on conflict do nothing;
end;
$$;

revoke all on function public.create_game(int, text) from public, anon;
revoke all on function public.join_game(text) from public, anon;
revoke all on function public.start_game(uuid) from public, anon;
revoke all on function public.submit_actions(uuid, int, jsonb) from public, anon;
revoke all on function public.skip_missing(uuid, int) from public, anon;
revoke all on function public.save_result(uuid, jsonb) from public, anon;
grant execute on function public.create_game(int, text) to authenticated;
grant execute on function public.join_game(text) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.submit_actions(uuid, int, jsonb) to authenticated;
grant execute on function public.skip_missing(uuid, int) to authenticated;
grant execute on function public.save_result(uuid, jsonb) to authenticated;

alter publication supabase_realtime add table public.games, public.teams, public.submissions;
