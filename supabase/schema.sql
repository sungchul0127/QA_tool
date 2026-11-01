-- Supabase 대시보드의 SQL Editor에서 한 번만 실행한다.
create table public.phrases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null check (char_length(trim(text)) > 0),
  created_at timestamptz not null default now()
);

alter table public.phrases enable row level security;

revoke all on public.phrases from anon, authenticated;
grant select, insert, update on public.phrases to authenticated;

create policy "본인 문구 조회" on public.phrases
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "본인 문구 등록" on public.phrases
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "본인 문구 수정" on public.phrases
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
