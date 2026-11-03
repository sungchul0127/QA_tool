-- Supabase SQL Editor에서 한 번 실행한다. migration-phrase-folders.sql 실행 이후 기준.
-- 별도배포확인: 배포 폴더(탭)와 그 안의 배포 건(표의 행).

create table public.deploy_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.deploy_folders enable row level security;
revoke all on public.deploy_folders from anon, authenticated;
grant select, insert, update, delete on public.deploy_folders to authenticated;

create policy "본인 배포 폴더 조회" on public.deploy_folders for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "본인 배포 폴더 등록" on public.deploy_folders for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "본인 배포 폴더 수정" on public.deploy_folders for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "본인 배포 폴더 삭제" on public.deploy_folders for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 폴더를 지우면 그 안의 배포 건도 지워진다.
create table public.deploy_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id uuid not null references public.deploy_folders (id) on delete cascade,
  qc text not null default '',
  job_code text not null default '',
  developer text not null default '',
  -- '3.0', '5.0', '5.6' 중 고른 값들
  file_types text[] not null default '{}',
  note text not null default '',
  pushed boolean not null default false,
  qc_checked boolean not null default false,
  -- 작을수록 위에 보인다. 끌어서 옮길 때 앞뒤 값의 중간값을 쓰므로 실수형이다.
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);

create index deploy_items_folder_sort_idx on public.deploy_items (folder_id, sort_order);

alter table public.deploy_items enable row level security;
revoke all on public.deploy_items from anon, authenticated;
grant select, insert, update, delete on public.deploy_items to authenticated;

create policy "본인 배포 건 조회" on public.deploy_items for select to authenticated
  using ((select auth.uid()) = user_id);
-- 본인 폴더에만 넣을 수 있다.
create policy "본인 배포 건 등록" on public.deploy_items for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.deploy_folders f where f.id = folder_id and f.user_id = (select auth.uid()))
  );
create policy "본인 배포 건 수정" on public.deploy_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.deploy_folders f where f.id = folder_id and f.user_id = (select auth.uid()))
  );
create policy "본인 배포 건 삭제" on public.deploy_items for delete to authenticated
  using ((select auth.uid()) = user_id);
