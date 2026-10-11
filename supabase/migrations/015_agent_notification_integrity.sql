-- Prevent signed-in clients from forging their reminder content by changing the
-- notification payload. Client updates may only toggle read_at.
create or replace function public.oms_agent_notification_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='authenticated' then
  if new.user_id is distinct from old.user_id
   or new.task_id is distinct from old.task_id
   or new.kind is distinct from old.kind
   or new.title is distinct from old.title
   or new.body is distinct from old.body
   or new.created_at is distinct from old.created_at then
   raise exception 'Only notification read status may be changed';
  end if;
 end if;
 return new;
end;$$;
drop trigger if exists oms_agent_notification_guard_trg on public.oms_agent_notifications;
create trigger oms_agent_notification_guard_trg before update on public.oms_agent_notifications
for each row execute function public.oms_agent_notification_guard();
