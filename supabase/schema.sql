-- Waib: andmebaasi skeem
-- Käivita see üks kord Supabase'i SQL Editoris. Uuesti käivitamine on ohutu.
--
-- Mida hoitakse:
--   waib_sets   nädala komplektid (avalik sisu: kaardid)
--   waib_tally  loendurid kaardi kohta (mitu "vaibib", mitu "ei vaibi")
--   waib_dist   jaotus: mitu vastajat sai kokku 0, 1, ... N "vaibib"
--   waib_seen   vastanute räsid ainult käimasoleva komplekti kohta
-- Üksikuid vastuseid ei salvestata kuhugi.

create table if not exists waib_sets (
  id         text primary key,
  label      text not null,
  cards      jsonb not null default '[]'::jsonb,
  published  boolean not null default false,
  opens_at   timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists waib_tally (
  set_id   text not null references waib_sets(id) on delete cascade,
  card_id  text not null,
  likes    integer not null default 0,
  dislikes integer not null default 0,
  primary key (set_id, card_id)
);

create table if not exists waib_dist (
  set_id text not null references waib_sets(id) on delete cascade,
  likes  integer not null,
  n      integer not null default 0,
  primary key (set_id, likes)
);

create table if not exists waib_seen (
  set_id text not null references waib_sets(id) on delete cascade,
  h      text not null,
  primary key (set_id, h)
);

-- Tabelitele ei pääse brauserist otse ligi: reataseme kaitse on sees ja
-- ühtegi lubavat reeglit ei ole. Ainult serverifunktsioon (salajase võtmega) loeb ja kirjutab.
alter table waib_sets  enable row level security;
alter table waib_tally enable row level security;
alter table waib_dist  enable row level security;
alter table waib_seen  enable row level security;

-- Käimasolev komplekt: viimane avaldatud komplekt, mille avamisaeg on käes.
create or replace function waib_current_id() returns text
language sql stable security definer set search_path = public as $$
  select id from waib_sets
  where published and opens_at <= now()
  order by opens_at desc, id desc
  limit 1
$$;

create or replace function waib_current() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'label', label, 'cards', cards)
  from waib_sets where id = waib_current_id()
$$;

-- Vastuse vastuvõtt. Tagastab: ok | already | closed | bad
-- Kõik toimub ühes tehingus: kas räsi, loendurid ja jaotus muutuvad koos või ei muutu miski.
create or replace function waib_submit(p_set text, p_hash text, p_answers jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_cards jsonb;
  v_ids   text[];
  k       text;
  v       integer;
  total   integer := 0;
begin
  if p_set is null or p_set <> coalesce(waib_current_id(), '') then
    return 'closed';
  end if;
  if p_hash is null or length(p_hash) < 32 or p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return 'bad';
  end if;

  select cards into v_cards from waib_sets where id = p_set;
  select array_agg(c->>'id') into v_ids from jsonb_array_elements(v_cards) c;
  if v_ids is null then return 'bad'; end if;

  if (select count(*) from jsonb_object_keys(p_answers)) <> array_length(v_ids, 1) then
    return 'bad';
  end if;
  foreach k in array v_ids loop
    if not (p_answers ? k) or (p_answers->>k) not in ('0', '1') then
      return 'bad';
    end if;
  end loop;

  insert into waib_seen(set_id, h) values (p_set, p_hash) on conflict do nothing;
  if not found then
    return 'already';
  end if;

  foreach k in array v_ids loop
    v := (p_answers->>k)::integer;
    total := total + v;
    insert into waib_tally(set_id, card_id, likes, dislikes) values (p_set, k, v, 1 - v)
    on conflict (set_id, card_id) do update
      set likes = waib_tally.likes + excluded.likes,
          dislikes = waib_tally.dislikes + excluded.dislikes;
  end loop;

  insert into waib_dist(set_id, likes, n) values (p_set, total, 1)
  on conflict (set_id, likes) do update set n = waib_dist.n + 1;

  -- Varasemate komplektide räsisid pole enam vaja: kustutame need.
  delete from waib_seen where set_id <> p_set;

  return 'ok';
end $$;

-- Koondstatistika. Kuni vastajaid on alla p_min, tagastatakse ainult vastajate arv,
-- et väikese arvu korral ei saaks koondarvudest üksiku inimese vastuseid välja lugeda.
create or replace function waib_stats(p_set text, p_min integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_n     integer;
  v_size  integer;
  v_cards jsonb;
  v_dist  jsonb;
begin
  select coalesce(sum(n), 0) into v_n from waib_dist where set_id = p_set;
  if v_n < greatest(p_min, 2) then
    return jsonb_build_object('n', v_n, 'min', greatest(p_min, 2));
  end if;

  select jsonb_array_length(cards) into v_size from waib_sets where id = p_set;
  select coalesce(jsonb_object_agg(card_id, jsonb_build_array(likes, dislikes)), '{}'::jsonb)
    into v_cards from waib_tally where set_id = p_set;
  select jsonb_agg(coalesce(d.n, 0) order by g.k) into v_dist
    from generate_series(0, coalesce(v_size, 0)) as g(k)
    left join waib_dist d on d.set_id = p_set and d.likes = g.k;

  return jsonb_build_object('n', v_n, 'min', greatest(p_min, 2), 'cards', v_cards, 'dist', v_dist);
end $$;

-- Toimetaja toimingud.
create or replace function waib_admin_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'label', s.label, 'published', s.published, 'opens_at', s.opens_at,
    'cards', jsonb_array_length(s.cards),
    'answers', (select coalesce(sum(n), 0) from waib_dist d where d.set_id = s.id)
  ) order by s.opens_at desc, s.id desc), '[]'::jsonb)
  from waib_sets s
$$;

create or replace function waib_admin_get(p_set text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'label', label, 'cards', cards, 'published', published, 'opens_at', opens_at,
    'answers', (select coalesce(sum(n), 0) from waib_dist d where d.set_id = waib_sets.id))
  from waib_sets where id = p_set
$$;

-- Tagastab: saved | locked | bad
-- Kui komplektile on juba vastatud, ei saa kaartide loetelu (id-sid) enam muuta, muidu läheksid loendurid sassi.
-- Sõnastust, silti, avamisaega ja avaldamist saab muuta ka siis.
create or replace function waib_admin_save(p_set text, p_label text, p_cards jsonb, p_published boolean, p_opens_at timestamptz)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_ans integer;
  v_cnt integer;
  v_distinct integer;
begin
  if p_set is null or p_set !~ '^[A-Za-z0-9_-]{1,40}$' or coalesce(p_label, '') = ''
     or p_cards is null or jsonb_typeof(p_cards) <> 'array' then
    return 'bad';
  end if;
  select count(*), count(distinct c->>'id') into v_cnt, v_distinct
    from jsonb_array_elements(p_cards) c where coalesce(c->>'id', '') ~ '^[A-Za-z0-9_-]{1,40}$';
  if v_cnt <> jsonb_array_length(p_cards) or v_distinct <> v_cnt or v_cnt > 60 then
    return 'bad';
  end if;

  select cards into v_old from waib_sets where id = p_set;
  if found then
    select coalesce(sum(n), 0) into v_ans from waib_dist where set_id = p_set;
    if v_ans > 0 and (
      select coalesce(array_agg(c->>'id' order by c->>'id'), '{}') from jsonb_array_elements(v_old) c
    ) <> (
      select coalesce(array_agg(c->>'id' order by c->>'id'), '{}') from jsonb_array_elements(p_cards) c
    ) then
      return 'locked';
    end if;
  end if;

  insert into waib_sets(id, label, cards, published, opens_at, updated_at)
  values (p_set, p_label, p_cards, coalesce(p_published, false), coalesce(p_opens_at, now()), now())
  on conflict (id) do update
    set label = excluded.label, cards = excluded.cards, published = excluded.published,
        opens_at = excluded.opens_at, updated_at = now();
  return 'saved';
end $$;

-- Funktsioone tohib kutsuda ainult serverifunktsioon (service_role), mitte brauser.
do $$
declare r text; f text;
begin
  foreach f in array array[
    'waib_current_id()', 'waib_current()', 'waib_submit(text, text, jsonb)', 'waib_stats(text, integer)',
    'waib_admin_list()', 'waib_admin_get(text)', 'waib_admin_save(text, text, jsonb, boolean, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
