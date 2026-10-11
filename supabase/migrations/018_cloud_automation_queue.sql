-- 018: PC-independent cloud automation queue.
-- Isolated from oms_jobs, which continues to contain the office-only DataDoc queue.
create table public.oms_cloud_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  process_id uuid not null references public.oms_processes(id) on delete cascade,
  process_no text not null check(process_no ~ '^[0-9]{5,9}$'),
  job_type text not null check(job_type in ('process_audit','document_extract')),
  status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object' and pg_column_size(payload)<=4096),
  result jsonb not null default '{}'::jsonb,
  error_message text,
  progress integer not null default 0 check(progress between 0 and 100),
  worker_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index oms_cloud_jobs_one_active_per_process_type
  on public.oms_cloud_jobs(process_id,job_type) where status in('queued','running');
create index oms_cloud_jobs_pending on public.oms_cloud_jobs(created_at,id) where status='queued';
create index oms_cloud_jobs_owner_recent on public.oms_cloud_jobs(user_id,created_at desc);
alter table public.oms_cloud_jobs enable row level security;
create policy oms_cloud_jobs_read on public.oms_cloud_jobs
 for select to authenticated using(
   user_id=auth.uid()
   or exists(select 1 from public.oms_processes p
              where p.id=process_id and public.oms_has_role(p.team_id))
 );
create policy oms_cloud_jobs_request on public.oms_cloud_jobs
 for insert to authenticated with check (
   user_id=auth.uid() and status='queued' and progress=0
   and result='{}'::jsonb and error_message is null and worker_name is null
   and started_at is null and finished_at is null
   and payload='{}'::jsonb
   and exists (
     select 1 from public.oms_processes p where p.id=process_id
       and p.process_no=process_no and p.deleted_at is null
       and (p.user_id=auth.uid() or public.oms_has_role(p.team_id,array['admin','operator']))
   )
 );
-- Do not grant UPDATE/DELETE to browser roles: worker RPCs control job states.
revoke update,delete on public.oms_cloud_jobs from authenticated,anon;
create table public.oms_cloud_workers(
  worker_name text primary key check(length(worker_name) between 3 and 80),
  status text not null default 'idle' check(status in ('idle','busy','error','paused')),
  last_seen_at timestamptz not null default now(),
  last_job_id uuid references public.oms_cloud_jobs(id) on delete set null,
  version text not null default '1',
  details jsonb not null default '{}'::jsonb check(pg_column_size(details)<=1000)
);
alter table public.oms_cloud_workers enable row level security;
create policy oms_cloud_workers_read on public.oms_cloud_workers
 for select to authenticated using(true);
revoke insert,update,delete on public.oms_cloud_workers from authenticated,anon;

create or replace function public.oms_cloud_claim(p_worker text)
returns setof public.oms_cloud_jobs
language plpgsql security definer set search_path=''
as $$
begin
  if p_worker is null or length(btrim(p_worker)) not between 3 and 80 then
    raise exception 'Valid cloud worker name required';
  end if;
  return query with claimable as (
     select j.id from public.oms_cloud_jobs j
     join public.oms_processes p on p.id=j.process_id
      where j.status='queued'
        and p.deleted_at is null and p.process_no=j.process_no
        and j.job_type in ('process_audit','document_extract')
      order by j.created_at,j.id
      for update of j skip locked limit 1
  )
  update public.oms_cloud_jobs j
     set status='running',progress=5,worker_name=p_worker,
         started_at=now(),updated_at=now()
   from claimable where j.id=claimable.id and j.status='queued'
  returning j.*;
end;
$$;
revoke all on function public.oms_cloud_claim(text) from public,anon,authenticated;
grant execute on function public.oms_cloud_claim(text) to service_role;

create or replace function public.oms_cloud_complete(
  p_job uuid,p_worker text,p_success boolean,p_result jsonb default '{}'::jsonb,p_error text default null
) returns boolean language plpgsql security definer set search_path=''
as $$
declare current_job public.oms_cloud_jobs%rowtype;
        details jsonb := coalesce(p_result,'{}'::jsonb);
        err text := left(coalesce(p_error,''),1000);
begin
  if jsonb_typeof(details)<>'object' or pg_column_size(details)>50000 then
    raise exception 'Cloud job result must be a small JSON object';
  end if;
  select * into current_job from public.oms_cloud_jobs
   where id=p_job and worker_name=p_worker and status='running' for update;
  if not found then raise exception 'Job is not claimed by this worker'; end if;
  update public.oms_cloud_jobs set
    status=case when p_success then 'completed' else 'failed' end,
    progress=case when p_success then 100 else 5 end,
    result=details,error_message=case when p_success then null else coalesce(nullif(err,''),'Cloud analysis failed') end,
    finished_at=now(),updated_at=now()
  where id=p_job;
  insert into public.oms_events(user_id,process_id,process_no,action,details)
  values(current_job.user_id,current_job.process_id,current_job.process_no,
         case when p_success then 'Cloud analysis completed' else 'Cloud analysis failed' end,
         jsonb_build_object('job_id',p_job,'job_type',current_job.job_type,'status',case when p_success then 'completed' else 'failed' end,'worker',p_worker));
  insert into public.oms_agent_notifications(user_id,kind,title,body)
  values(current_job.user_id,'update',
         case when p_success then 'Cloud analysis complete: ' else 'Cloud analysis needs review: ' end||current_job.process_no,
         left(case when p_success then
           'Open AI Command Center to review the result of '||replace(current_job.job_type,'_',' ')||'.'
           else coalesce(nullif(err,''),'Check the cloud job result.') end,600));
  return true;
end;
$$;
revoke all on function public.oms_cloud_complete(uuid,text,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.oms_cloud_complete(uuid,text,boolean,jsonb,text) to service_role;

-- Read-only cloud work cannot call bill_submit, datadoc_submit, or email_reply.
-- Existing office jobs, files and processes remain unchanged.
