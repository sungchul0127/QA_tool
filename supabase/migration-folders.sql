-- Supabase SQL Editor에서 한 번 실행한다. 기존 supabase/schema.sql 실행 이후 기준.

-- 1) 폴더 테이블 (빈 폴더도 유지해야 하므로 별도 테이블)
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.folders enable row level security;
revoke all on public.folders from anon, authenticated;
grant select, insert, update, delete on public.folders to authenticated;

create policy "본인 폴더 조회" on public.folders for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "본인 폴더 등록" on public.folders for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "본인 폴더 수정" on public.folders for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "본인 폴더 삭제" on public.folders for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 2) 문구에 폴더와 정렬 순서 추가
alter table public.phrases
  add column folder_id uuid references public.folders (id) on delete set null,
  add column sort_order double precision;

-- 기존 문구는 최신순 그대로 순서를 매긴다.
update public.phrases p
set sort_order = s.rn
from (
  select id, row_number() over (partition by user_id order by created_at desc) as rn
  from public.phrases
) s
where p.id = s.id;

alter table public.phrases alter column sort_order set not null;
alter table public.phrases alter column sort_order set default 0;

create index phrases_user_sort_idx on public.phrases (user_id, sort_order);
