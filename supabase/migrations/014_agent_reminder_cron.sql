-- Schedule private reminder notifications every minute.
-- Job creates durable in-app notifications; browser push/email still require a separate delivery channel.
create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
 if not exists(select 1 from cron.job where jobname='pjs-oms-agent-due-reminders') then
  perform cron.schedule('pjs-oms-agent-due-reminders','* * * * *','select public.oms_agent_enqueue_due_reminders();');
 end if;
end;$$;
