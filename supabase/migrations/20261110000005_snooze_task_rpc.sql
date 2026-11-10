-- =============================================================================
-- MyLife Hub — Phase 2-1: snooze_task RPC
-- Lets any household member snooze a FAMILY task (and the owner snooze their PRIVATE task),
-- which plain RLS on `tasks` cannot express. Same conventions as the Phase 1-2 RPCs:
-- SECURITY DEFINER + fixed search_path, idempotency via _claim_idempotency, task row lock.
-- =============================================================================

create or replace function public.snooze_task(
  p_task_id         uuid,
  p_days            int,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_hid      uuid;
  v_actor    text;
  v_cached   jsonb;
  v_task     public.tasks;
  v_today    date := (now() at time zone 'Asia/Seoul')::date;   -- Seoul calendar date (CLAUDE.md §4.C)
  v_prev_due date;
  v_prev_st  public.task_status;
  v_new      date;
  v_result   jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_days is null or p_days not between 1 and 60 then
    raise exception 'INVALID_DAYS' using errcode = '22023';
  end if;

  -- Caller's household comes from their profile, never from client input.
  v_hid := public.current_household_id();
  if v_hid is null then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_actor := 'user:' || v_uid::text;

  -- Idempotency: the key is bound to this exact (task, days). A replay returns the stored result;
  -- the same key with different arguments raises IDEMPOTENCY_KEY_REUSED.
  v_cached := public._claim_idempotency(
    v_hid,
    v_actor,
    p_idempotency_key,
    encode(sha256(convert_to('snooze:' || p_task_id::text || ':' || p_days::text, 'UTF8')), 'hex')
  );
  if v_cached is not null then
    return v_cached;
  end if;

  -- Row lock (tasks only: snoozing never touches task_rules, so the global lock order holds).
  select * into v_task
    from public.tasks
   where id = p_task_id and household_id = v_hid
     for update;

  -- Same household AND (FAMILY task OR the caller's own task). Another member's PRIVATE task is off-limits
  -- even for an ADMIN (private isolation). One generic error for "missing" and "not allowed".
  if not found
     or (v_task.visibility = 'PRIVATE' and v_task.owner_id <> v_uid) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- Only open tasks can be snoozed (COMPLETED / SKIPPED / CANCELLED cannot).
  if v_task.status not in ('PENDING', 'SNOOZED') then
    raise exception 'INVALID_TASK_STATUS' using errcode = '22023';
  end if;

  v_prev_due := v_task.due_date;
  v_prev_st  := v_task.status;
  -- Counted from the later of (current due date, today): snoozing an overdue task by 3 days = 3 days from today.
  v_new := greatest(v_task.due_date, v_today) + p_days;

  -- due_date moves too: the timeline, D-Day badges and recurrence all read due_date.
  update public.tasks
     set status = 'SNOOZED', due_date = v_new, snoozed_until = v_new
   where id = v_task.id;

  insert into public.event_logs (
    household_id, owner_id, visibility, task_id, asset_id,
    event_type, actor_identifier, idempotency_key, payload
  ) values (
    v_task.household_id, v_task.owner_id, v_task.visibility, v_task.id, v_task.asset_id,
    'TASK_SNOOZED', v_actor, p_idempotency_key,
    jsonb_build_object(
      'days', p_days,
      'previous_due_date', v_prev_due,
      'new_due_date', v_new,
      'previous_status', v_prev_st
    )
  );

  v_result := jsonb_build_object(
    'task_id', v_task.id,
    'status', 'SNOOZED',
    'previous_due_date', v_prev_due,
    'due_date', v_new,
    'snoozed_until', v_new
  );
  perform public._store_idempotency_response(v_hid, v_actor, p_idempotency_key, v_result);
  return v_result;
end;
$$;

revoke all on function public.snooze_task(uuid, int, text) from public, anon;
grant execute on function public.snooze_task(uuid, int, text) to authenticated;
