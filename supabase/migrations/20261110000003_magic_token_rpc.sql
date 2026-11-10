-- =============================================================================
-- MyLife Hub — Phase 1-5: create_magic_token RPC
-- Replaces the service-role insert in the app: the caller's own JWT is enough,
-- authorization is verified inside the function (same household + task visibility).
-- Lock order note (CLAUDE.md §4.B): this function touches magic_tokens only
-- (tasks are read WITHOUT locks), so it can never deadlock with complete_via_magic_token
-- (magic_tokens -> tasks -> task_rules).
-- =============================================================================

create or replace function public.create_magic_token(
  p_task_id    uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_hid   uuid;
  v_task  public.tasks;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_TOKEN_HASH' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'INVALID_EXPIRY' using errcode = '22023';
  end if;

  -- Caller's household, resolved from their profile (never from client input).
  select household_id into v_hid from public.profiles where id = v_uid;

  -- Same-household check + task visibility (FAMILY, or the caller's own PRIVATE task).
  -- One generic error for "no such task" and "not yours" so task ids cannot be probed.
  select * into v_task from public.tasks where id = p_task_id;
  if v_hid is null
     or not found
     or v_task.household_id <> v_hid
     or (v_task.visibility = 'PRIVATE' and v_task.owner_id <> v_uid) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if v_task.status not in ('PENDING', 'SNOOZED') then
    raise exception 'TASK_NOT_ACTIONABLE';
  end if;

  -- Atomic: retire every still-active, unconsumed token of this task, then issue the new one.
  update public.magic_tokens
     set expires_at = now()
   where task_id = p_task_id
     and consumed_at is null
     and expires_at > now();

  insert into public.magic_tokens (household_id, task_id, token_hash, expires_at, created_by)
  values (v_task.household_id, p_task_id, p_token_hash, p_expires_at, v_uid)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'expires_at', p_expires_at);
end;
$$;

revoke all on function public.create_magic_token(uuid, text, timestamptz) from public, anon;
grant execute on function public.create_magic_token(uuid, text, timestamptz) to authenticated;
