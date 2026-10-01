-- Truquito · tabla para compartir el historial entre celulares.
-- Pegalo en Supabase → SQL Editor → Run.

create table if not exists public.truco_groups (
  code        text primary key check (char_length(code) between 4 and 64),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.truco_groups enable row level security;

-- Cualquiera que sepa el código del grupo puede leer y escribir ese grupo.
-- (El código funciona como contraseña: usá uno difícil de adivinar.)
drop policy if exists "leer grupo" on public.truco_groups;
drop policy if exists "crear grupo" on public.truco_groups;
drop policy if exists "actualizar grupo" on public.truco_groups;

create policy "leer grupo"       on public.truco_groups for select to anon using (true);
create policy "crear grupo"      on public.truco_groups for insert to anon with check (true);
create policy "actualizar grupo" on public.truco_groups for update to anon using (true) with check (true);
