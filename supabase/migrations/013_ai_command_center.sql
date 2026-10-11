
create table if not exists public.oms_agent_messages(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('user','assistant','system')),
 content text not null check(char_length(btrim(content)) between 1 and 12000),
 source text not null default 'local' check(source in ('local','ai','web','system')),
 created_at timestamptz not null default now()
);
create index if not exists oms_agent_messages_user_recent on public.oms_agent_messages(user_id,created_at desc);
alter table public.oms_agent_messages enable row level security;
create policy oms_agent_messages_read on public.oms_agent_messages for select to authenticated using(user_id=auth.uid());
create policy oms_agent_messages_write on public.oms_agent_messages for insert to authenticated with check(user_id=auth.uid() and role in('user','assistant'));
create policy oms_agent_messages_delete on public.oms_agent_messages for delete to authenticated using(user_id=auth.uid());

create table if not exists public.oms_agent_tasks(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(btrim(title)) between 3 and 240),
 details text not null default '' check(char_length(details)<=3000),
 process_no text check(process_no is null or process_no ~ '^[0-9]{5,9}$'),
 status text not null default 'pending' check(status in('pending','completed','cancelled')),
 due_at timestamptz,remind_at timestamptz,completed_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(id,user_id)
);
create index if not exists oms_agent_tasks_upcoming on public.oms_agent_tasks(user_id,status,remind_at);
alter table public.oms_agent_tasks enable row level security;
create policy oms_agent_tasks_read on public.oms_agent_tasks for select to authenticated using(user_id=auth.uid());
create policy oms_agent_tasks_insert on public.oms_agent_tasks for insert to authenticated with check(user_id=auth.uid());
create policy oms_agent_tasks_update on public.oms_agent_tasks for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy oms_agent_tasks_delete on public.oms_agent_tasks for delete to authenticated using(user_id=auth.uid());
create or replace function public.oms_agent_task_guard() returns trigger language plpgsql set search_path=''
as $$
begin
 if tg_op='UPDATE' then
  if new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at then
   raise exception 'Cannot change task ownership or creation timestamp';
  end if;
  if old.status<>'completed' and new.status='completed' then new.completed_at=now();end if;
  if new.status<>'completed' then new.completed_at=null;end if;
 end if;
 new.updated_at=now();
 return new;
end;$$;
create trigger oms_agent_task_guard_trg before update on public.oms_agent_tasks for each row execute function public.oms_agent_task_guard();

create table if not exists public.oms_agent_notifications(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid,kind text not null check(kind in('reminder','update')),
 title text not null check(char_length(title) between 1 and 250),
 body text not null default '',read_at timestamptz,created_at timestamptz not null default now(),
 foreign key(task_id,user_id) references public.oms_agent_tasks(id,user_id) on delete cascade
);
create unique index if not exists oms_agent_notification_unique_task on public.oms_agent_notifications(task_id,kind) where task_id is not null;
create index if not exists oms_agent_notifications_unread on public.oms_agent_notifications(user_id,created_at desc) where read_at is null;
alter table public.oms_agent_notifications enable row level security;
create policy oms_agent_notification_read on public.oms_agent_notifications for select to authenticated using(user_id=auth.uid());
create policy oms_agent_notification_update on public.oms_agent_notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke insert,delete on public.oms_agent_notifications from anon,authenticated;

create or replace function public.oms_agent_enqueue_due_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare c integer;
begin
 insert into public.oms_agent_notifications(user_id,task_id,kind,title,body)
 select t.user_id,t.id,'reminder','Reminder: '||left(t.title,200),
        coalesce(nullif(t.details,''),'Scheduled task reminder')||
        case when t.process_no is not null then ' · Process '||t.process_no else '' end
 from public.oms_agent_tasks t where t.status='pending' and t.remind_at is not null and t.remind_at<=now()
 on conflict do nothing;
 get diagnostics c=row_count;return c;
end;$$;
revoke execute on function public.oms_agent_enqueue_due_reminders() from public,anon,authenticated;
grant execute on function public.oms_agent_enqueue_due_reminders() to service_role;
