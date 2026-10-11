-- Independent PJS OMS: DataDoc work waits safely in Supabase until an authorized
-- Windows office worker signs in. Existing queued jobs are NOT enabled for auto-run.
alter table public.oms_jobs add column if not exists office_execution text not null default 'manual';
alter table public.oms_jobs add column if not exists approved_at timestamptz;
alter table public.oms_jobs add column if not exists started_at timestamptz;
alter table public.oms_jobs add column if not exists finished_at timestamptz;
alter table public.oms_jobs add column if not exists worker_name text;
alter table public.oms_jobs add constraint oms_jobs_office_execution_check check (office_execution in ('manual','auto_on_login'));
create unique index if not exists oms_jobs_one_live_per_type
 on public.oms_jobs(process_id,job_type) where status in ('queued','running');
create index if not exists oms_jobs_auto_datadoc_queue
 on public.oms_jobs(user_id,created_at) where status='queued' and job_type='bill_submit' and office_execution='auto_on_login';

create or replace function public.oms_prepare_office_job()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.office_execution='auto_on_login' then
  if new.job_type<>'bill_submit' then
    raise exception 'Only DataDoc Bill Submit may auto-run on office PC';
  end if;
  if auth.uid() is distinct from new.user_id and current_user<>'service_role' then
    raise exception 'Only the authorizing user may queue an office bill submit';
  end if;
  new.approved_at=now();
 else
  new.approved_at=null;
 end if;
 return new;
end;$$;
drop trigger if exists oms_jobs_office_approval on public.oms_jobs;
create trigger oms_jobs_office_approval before insert on public.oms_jobs
for each row execute function public.oms_prepare_office_job();

create table if not exists public.oms_office_workers(
 owner_id uuid primary key references auth.users(id) on delete cascade,
 worker_name text not null,
 machine_name text not null default '',
 status text not null default 'offline' check (status in ('ready','idle','busy','paused','error','offline')),
 current_job_id uuid references public.oms_jobs(id) on delete set null,
 details jsonb not null default '{}'::jsonb,
 last_seen_at timestamptz not null default now()
);
alter table public.oms_office_workers enable row level security;
drop policy if exists oms_office_workers_read on public.oms_office_workers;
create policy oms_office_workers_read on public.oms_office_workers for select to authenticated
 using(owner_id=auth.uid());
revoke insert,update,delete on public.oms_office_workers from anon,authenticated;

create or replace function public.oms_claim_approved_office_bill(p_worker_name text,p_owner_id uuid)
returns setof public.oms_jobs language plpgsql security definer set search_path='' as $$
begin
 if p_owner_id is null or length(trim(p_worker_name)) not between 3 and 100 then
  raise exception 'Worker identity is required';
 end if;
 return query
 with candidate as (
  select j.id
    from public.oms_jobs j
    join public.oms_processes p on p.id=j.process_id
   where j.user_id=p_owner_id
     and j.status='queued'
     and j.job_type='bill_submit'
     and j.office_execution='auto_on_login'
     and j.approved_at is not null
     and p.deleted_at is null
     and p.process_no=j.process_no
   order by j.created_at,j.id
   for update of j skip locked
   limit 1
 )
 update public.oms_jobs j
    set status='running',
        progress=5,started_at=now(),updated_at=now(),
        worker_name=p_worker_name,error_message=null
   from candidate
  where j.id=candidate.id
    and j.status='queued'
 returning j.*;
end;$$;
revoke all on function public.oms_claim_approved_office_bill(text,uuid) from public,anon,authenticated;
grant execute on function public.oms_claim_approved_office_bill(text,uuid) to service_role;
