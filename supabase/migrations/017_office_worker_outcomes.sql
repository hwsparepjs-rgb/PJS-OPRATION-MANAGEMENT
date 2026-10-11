-- Record one DataDoc outcome and notify the submitter in a single transaction.
-- A failed or interrupted external submission is NEVER requeued automatically.
create or replace function public.oms_finish_approved_office_bill(
 p_job_id uuid,
 p_worker_name text,
 p_success boolean,
 p_details text default ''
)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_job public.oms_jobs%rowtype;
        v_process public.oms_processes%rowtype;
        v_description text := left(coalesce(p_details,''),1300);
begin
 select * into v_job from public.oms_jobs
 where id=p_job_id and job_type='bill_submit' and office_execution='auto_on_login'
   and status='running' and worker_name=p_worker_name
 for update;
 if not found then raise exception 'Job is not a live claim of this worker'; end if;
 if p_success then
  select * into v_process from public.oms_processes
    where id=v_job.process_id and process_no=v_job.process_no and deleted_at is null
    for update;
  if not found then raise exception 'Process was deleted or changed; manual reconciliation required';end if;
  update public.oms_processes
     set data=jsonb_set(jsonb_set(jsonb_set(
       coalesce(data,'{}'::jsonb),
       '{stage}',to_jsonb('Email to Client'::text),true),
       '{status}',to_jsonb('Ready for Email'::text),true),
       '{datadoc_status}',to_jsonb('COMPLETED'::text),true)
       ||jsonb_build_object('datadoc_result',v_description),
     updated_at=now()
   where id=v_job.process_id;
 end if;
 update public.oms_jobs
    set status=case when p_success then 'completed' else 'failed' end,
        progress=case when p_success then 100 else progress end,
        result=jsonb_build_object('worker',p_worker_name,'data_doc',case when p_success then 'confirmed' else 'requires_review' end,'message',v_description),
        error_message=case when p_success then null else 'Check DataDoc for partial success before requeueing. '||v_description end,
        finished_at=now(),updated_at=now()
 where id=p_job_id;

 insert into public.oms_events(user_id,process_id,process_no,action,details)
 values(v_job.user_id,v_job.process_id,v_job.process_no,
        case when p_success then 'DataDoc Bill Submit confirmed by office worker'
                           else 'DataDoc Bill Submit needs manual review' end,
        jsonb_build_object('job_id',p_job_id,'worker',p_worker_name,'detail',v_description));

 insert into public.oms_agent_notifications(user_id,kind,title,body)
 values(v_job.user_id,'update',
        case when p_success then 'DataDoc submitted: ' else 'Review DataDoc: ' end||v_job.process_no,
        left(v_description,600));
 return true;
end;$$;
revoke all on function public.oms_finish_approved_office_bill(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.oms_finish_approved_office_bill(uuid,text,boolean,text) to service_role;
