-- Supabase SQL Editor에서 한 번 실행한다. migration-deploy-manual.sql 실행 이후 기준.
-- 배포 폴더·매뉴얼 탭을 끌어서 순서를 바꿀 수 있게 순서 값을 둔다. (문구 폴더는 folders.sort_order를 이미 쓴다.)
-- 작을수록 왼쪽에 보인다. 지금 보이는 순서(최신이 왼쪽)를 그대로 옮겨 둔다.

alter table public.deploy_folders add column sort_order integer not null default 0;
alter table public.manuals add column sort_order integer not null default 0;

update public.deploy_folders d
set sort_order = r.n
from (select id, row_number() over (partition by user_id order by created_at desc) as n from public.deploy_folders) r
where d.id = r.id;

update public.manuals m
set sort_order = r.n
from (select id, row_number() over (partition by user_id order by created_at desc) as n from public.manuals) r
where m.id = r.id;
