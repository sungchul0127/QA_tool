-- Supabase SQL Editor에서 한 번 실행한다. migration-deploy-check.sql 실행 이후 기준.
-- 배포 매뉴얼: 매뉴얼(탭)과 그 안의 큰 단계·세부단계.

create table public.manuals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.manuals enable row level security;
revoke all on public.manuals from anon, authenticated;
grant select, insert, update, delete on public.manuals to authenticated;

create policy "본인 매뉴얼 조회" on public.manuals for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "본인 매뉴얼 등록" on public.manuals for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "본인 매뉴얼 수정" on public.manuals for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "본인 매뉴얼 삭제" on public.manuals for delete to authenticated
  using ((select auth.uid()) = user_id);

-- parent_id가 비어 있으면 큰 단계, 있으면 그 큰 단계의 세부단계다.
-- 매뉴얼이나 큰 단계를 지우면 그 안의 단계도 지워진다.
create table public.manual_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  manual_id uuid not null references public.manuals (id) on delete cascade,
  parent_id uuid references public.manual_steps (id) on delete cascade,
  text text not null default '',
  -- 세부단계의 완료 여부. 큰 단계는 세부단계가 없을 때만 이 값을 쓴다.
  checked boolean not null default false,
  -- 작을수록 위에 보인다. 끌어서 옮길 때 앞뒤 값의 중간값을 쓰므로 실수형이다.
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);

create index manual_steps_manual_sort_idx on public.manual_steps (manual_id, sort_order);
create index manual_steps_parent_idx on public.manual_steps (parent_id);

alter table public.manual_steps enable row level security;
revoke all on public.manual_steps from anon, authenticated;
grant select, insert, update, delete on public.manual_steps to authenticated;

create policy "본인 매뉴얼 단계 조회" on public.manual_steps for select to authenticated
  using ((select auth.uid()) = user_id);
-- 본인 매뉴얼에만 넣을 수 있다.
create policy "본인 매뉴얼 단계 등록" on public.manual_steps for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.manuals m where m.id = manual_id and m.user_id = (select auth.uid()))
  );
create policy "본인 매뉴얼 단계 수정" on public.manual_steps for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.manuals m where m.id = manual_id and m.user_id = (select auth.uid()))
  );
create policy "본인 매뉴얼 단계 삭제" on public.manual_steps for delete to authenticated
  using ((select auth.uid()) = user_id);
