-- 새 Supabase 프로젝트의 SQL Editor에서 한 번만 실행한다.
-- 이미 예전 schema.sql을 실행한 프로젝트는 대신 migration-folders.sql, migration-phrase-folders.sql, migration-deploy-check.sql을 차례로 실행한다.

-- 빈 폴더도 유지해야 하므로 별도 테이블로 둔다.
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

create policy "본인 폴더 조회" on public.folders
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "본인 폴더 등록" on public.folders
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "본인 폴더 수정" on public.folders
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "본인 폴더 삭제" on public.folders
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create table public.phrases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  text text not null check (char_length(trim(text)) > 0),
  -- 작을수록 위에 보인다. 끌어서 옮길 때 앞뒤 값의 중간값을 쓰므로 실수형이다.
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);

create index phrases_user_sort_idx on public.phrases (user_id, sort_order);

alter table public.phrases enable row level security;

revoke all on public.phrases from anon, authenticated;
grant select, insert, update, delete on public.phrases to authenticated;

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

create policy "본인 문구 삭제" on public.phrases
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 문구 하나를 여러 폴더에 넣을 수 있다. 폴더나 문구를 지우면 연결도 지워진다.
create table public.phrase_folders (
  phrase_id uuid not null references public.phrases (id) on delete cascade,
  folder_id uuid not null references public.folders (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (phrase_id, folder_id)
);

create index phrase_folders_folder_idx on public.phrase_folders (folder_id);

alter table public.phrase_folders enable row level security;

revoke all on public.phrase_folders from anon, authenticated;
grant select, insert, delete on public.phrase_folders to authenticated;

create policy "본인 연결 조회" on public.phrase_folders
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- 본인 문구를 본인 폴더에만 넣을 수 있다.
create policy "본인 연결 등록" on public.phrase_folders
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.phrases p where p.id = phrase_id and p.user_id = (select auth.uid()))
    and exists (select 1 from public.folders f where f.id = folder_id and f.user_id = (select auth.uid()))
  );

create policy "본인 연결 삭제" on public.phrase_folders
  for delete to authenticated
  using ((select auth.uid()) = user_id);

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
