-- Supabase SQL Editor에서 한 번 실행한다. migration-folders.sql 실행 이후 기준.
-- 문구 하나를 여러 폴더에 넣을 수 있도록 phrases.folder_id를 연결 테이블로 바꾼다.

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

create policy "본인 연결 조회" on public.phrase_folders for select to authenticated
  using ((select auth.uid()) = user_id);
-- 본인 문구를 본인 폴더에만 넣을 수 있다.
create policy "본인 연결 등록" on public.phrase_folders for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.phrases p where p.id = phrase_id and p.user_id = (select auth.uid()))
    and exists (select 1 from public.folders f where f.id = folder_id and f.user_id = (select auth.uid()))
  );
create policy "본인 연결 삭제" on public.phrase_folders for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 기존 문구는 원래 폴더 하나에 그대로 들어간다.
insert into public.phrase_folders (phrase_id, folder_id, user_id)
select id, folder_id, user_id
from public.phrases
where folder_id is not null;

alter table public.phrases drop column folder_id;
