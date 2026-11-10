-- =============================================================================
-- MyLife Hub — Phase 1-3: Quality Gates (SQL Editor에서 Run 한 번)
--   ① 날짜 보정  ② 멱등성  ③ Magic Token 만료/소비  ④ 중복 완료 방지
-- 실패 시 ASSERT/EXCEPTION 으로 DO 블록 전체가 롤백(테스트 데이터 잔존 없음).
-- 성공 시 마지막에 fixture 를 명시적으로 삭제한다.
-- =============================================================================
do $$
declare
  v_uid     uuid := gen_random_uuid();
  v_hid     uuid;
  v_rule    uuid;
  v_t1      uuid;
  v_t2      uuid;
  v_t3      uuid;
  v_r1      jsonb;
  v_r2      jsonb;
  v_cnt     int;
  v_msg     text;
  v_raised  boolean;
  v_raw     text;
  v_ts      timestamptz;
  v_due     date;
  v_status  public.task_status;
  v_consumed timestamptz;
begin
  -- ---------------------------------------------------------------- fixtures
  insert into auth.users (id, aud, role, email)
  values (v_uid, 'authenticated', 'authenticated', 'qg-' || v_uid || '@example.invalid');

  insert into public.households (name) values ('QG Test Household') returning id into v_hid;
  insert into public.profiles (id, household_id, role, display_name)
  values (v_uid, v_hid, 'ADMIN', 'QG Admin');

  -- auth.uid() 가 v_uid 를 반환하도록 JWT claim 주입 (트랜잭션 로컬)
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- ================================================================ ① 날짜 보정
  -- 1/31 -> 2/28 (평년)
  v_ts := public.calculate_next_due_date(
            timestamp '2027-01-31 09:00' at time zone 'Asia/Seoul', 'MONTHLY', 1, 31);
  assert (v_ts at time zone 'Asia/Seoul') = timestamp '2027-02-28 09:00',
         format('[G1] 2027-01-31 +1M expected 2027-02-28 09:00 KST, got %s', v_ts at time zone 'Asia/Seoul');

  -- 1/31 -> 2/29 (윤년)
  v_ts := public.calculate_next_due_date(
            timestamp '2028-01-31 09:00' at time zone 'Asia/Seoul', 'MONTHLY', 1, 31);
  assert (v_ts at time zone 'Asia/Seoul') = timestamp '2028-02-29 09:00',
         format('[G1] 2028-01-31 +1M expected 2028-02-29, got %s', v_ts at time zone 'Asia/Seoul');

  -- 3/31 -> 4/30 (30일 달)
  v_ts := public.calculate_next_due_date(
            timestamp '2027-03-31 09:00' at time zone 'Asia/Seoul', 'MONTHLY', 1, 31);
  assert (v_ts at time zone 'Asia/Seoul') = timestamp '2027-04-30 09:00',
         format('[G1] 2027-03-31 +1M expected 2027-04-30, got %s', v_ts at time zone 'Asia/Seoul');

  -- 보정된 4/30 에서 target_day=31 이면 5/31 로 복원
  v_ts := public.calculate_next_due_date(
            timestamp '2027-04-30 09:00' at time zone 'Asia/Seoul', 'MONTHLY', 1, 31);
  assert (v_ts at time zone 'Asia/Seoul') = timestamp '2027-05-31 09:00',
         format('[G1] 2027-04-30 +1M(target 31) expected 2027-05-31, got %s', v_ts at time zone 'Asia/Seoul');

  -- target_day 미지정 시 현재 일자 유지 + 말일 보정
  v_ts := public.calculate_next_due_date(
            timestamp '2027-01-31 09:00' at time zone 'Asia/Seoul', 'MONTHLY', 1, null);
  assert (v_ts at time zone 'Asia/Seoul') = timestamp '2027-02-28 09:00', '[G1] null target_day clamp failed';

  -- 연 반복: 윤일(2/29) -> 평년 2/28
  v_ts := public.calculate_next_due_date(
            timestamp '2028-02-29 09:00' at time zone 'Asia/Seoul', 'YEARLY', 1, 29);
  assert (v_ts at time zone 'Asia/Seoul') = timestamp '2029-02-28 09:00', '[G1] yearly Feb-29 clamp failed';

  -- 연도 넘김 12/31 + 2개월 = 2/28
  v_ts := public.calculate_next_due_date(
            timestamp '2026-12-31 09:00' at time zone 'Asia/Seoul', 'MONTHLY', 2, 31);
  assert (v_ts at time zone 'Asia/Seoul') = timestamp '2027-02-28 09:00', '[G1] year-wrap clamp failed';

  -- NONE 은 NULL
  assert public.calculate_next_due_date(now(), 'NONE', 1, null) is null, '[G1] NONE must return null';

  -- ================================================================ ② 멱등성
  insert into public.task_rules (household_id, owner_id, title, recurring_type, interval_n, anchor, day_of_month)
  values (v_hid, v_uid, 'QG 월말 반복', 'MONTHLY', 1, 'DUE_DATE', 31)
  returning id into v_rule;

  insert into public.tasks (household_id, owner_id, rule_id, iteration_no, title, due_date)
  values (v_hid, v_uid, v_rule, 1, 'QG 월말 반복', date '2027-01-31')
  returning id into v_t1;

  v_r1 := public.complete_task_and_generate_next(v_t1, 'qg-idem-key-0001', 'hash-A');
  v_r2 := public.complete_task_and_generate_next(v_t1, 'qg-idem-key-0001', 'hash-A');

  assert v_r1 = v_r2, format('[G2] replay must return identical response: %s vs %s', v_r1, v_r2);
  assert (v_r1 ->> 'status') = 'COMPLETED' and (v_r1 ->> 'already_completed') = 'false',
         '[G2] first call must be a fresh completion';

  select count(*) into v_cnt from public.tasks where rule_id = v_rule and iteration_no = 2;
  assert v_cnt = 1, format('[G2] exactly one next iteration expected, found %s', v_cnt);

  select count(*) into v_cnt from public.tasks where rule_id = v_rule;
  assert v_cnt = 2, format('[G2] rule must have exactly 2 tasks, found %s', v_cnt);

  select count(*) into v_cnt from public.event_logs
   where task_id = v_t1 and event_type = 'TASK_COMPLETED';
  assert v_cnt = 1, format('[G2] exactly one completion log expected, found %s', v_cnt);

  select count(*) into v_cnt from public.idempotency_keys
   where household_id = v_hid and idempotency_key = 'qg-idem-key-0001';
  assert v_cnt = 1, '[G2] exactly one idempotency row expected';

  select id, due_date into v_t2, v_due from public.tasks where rule_id = v_rule and iteration_no = 2;
  assert v_due = date '2027-02-28', format('[G2] next due must be clamped to 2027-02-28, got %s', v_due);
  assert (v_r1 ->> 'next_task_id')::uuid = v_t2, '[G2] next_task_id must reference iteration 2';

  -- 같은 키 + 다른 request_hash => 거부
  v_raised := false;
  begin
    perform public.complete_task_and_generate_next(v_t1, 'qg-idem-key-0001', 'hash-DIFFERENT');
  exception when others then
    v_raised := true; v_msg := sqlerrm;
  end;
  assert v_raised and v_msg = 'IDEMPOTENCY_KEY_REUSED',
         format('[G2] reused key with different hash must raise IDEMPOTENCY_KEY_REUSED, got %L', v_msg);

  -- ================================================================ ③ Magic Token
  -- (a) 만료 토큰
  insert into public.tasks (household_id, owner_id, title, due_date)
  values (v_hid, v_uid, 'QG magic expired', date '2027-03-01') returning id into v_t3;

  v_raw := 'qg-expired-token-' || gen_random_uuid()::text;
  insert into public.magic_tokens (household_id, task_id, token_hash, expires_at)
  values (v_hid, v_t3, encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), now() - interval '1 hour');

  v_raised := false;
  begin
    perform public.complete_via_magic_token(v_raw, 'qg-magic-key-0001', 'hash-M1');
  exception when others then
    v_raised := true; v_msg := sqlerrm;
  end;
  assert v_raised and v_msg = 'TOKEN_EXPIRED',
         format('[G3] expired token must raise TOKEN_EXPIRED, got %L', v_msg);
  select status into v_status from public.tasks where id = v_t3;
  assert v_status = 'PENDING', '[G3] expired token must not complete the task';

  -- (b) 유효 토큰 -> 성공 + 즉시 소비
  insert into public.tasks (household_id, owner_id, title, due_date)
  values (v_hid, v_uid, 'QG magic valid', date '2027-03-02') returning id into v_t3;

  v_raw := 'qg-valid-token-' || gen_random_uuid()::text;
  insert into public.magic_tokens (household_id, task_id, token_hash, expires_at)
  values (v_hid, v_t3, encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), now() + interval '1 day');

  v_r1 := public.complete_via_magic_token(v_raw, 'qg-magic-key-0002', 'hash-M2');
  assert (v_r1 ->> 'status') = 'COMPLETED', '[G3] valid token must complete the task';

  select status into v_status from public.tasks where id = v_t3;
  assert v_status = 'COMPLETED', '[G3] task must be COMPLETED after magic completion';
  select consumed_at into v_consumed from public.magic_tokens
   where token_hash = encode(sha256(convert_to(v_raw, 'UTF8')), 'hex');
  assert v_consumed is not null, '[G3] token must be consumed immediately';

  select count(*) into v_cnt from public.event_logs
   where task_id = v_t3 and event_type = 'MAGIC_LINK_COMPLETED';
  assert v_cnt = 1, '[G3] exactly one MAGIC_LINK_COMPLETED log expected';

  -- (c) 동일 멱등성 키 재전송 -> 캐시 응답 (토큰이 소비된 후에도)
  v_r2 := public.complete_via_magic_token(v_raw, 'qg-magic-key-0002', 'hash-M2');
  assert v_r1 = v_r2, '[G3] same idempotency key must replay cached response';

  -- (d) 소비된 토큰 + 새 키 -> 거부
  v_raised := false;
  begin
    perform public.complete_via_magic_token(v_raw, 'qg-magic-key-0003', 'hash-M3');
  exception when others then
    v_raised := true; v_msg := sqlerrm;
  end;
  assert v_raised and v_msg = 'TOKEN_CONSUMED',
         format('[G3] consumed token must raise TOKEN_CONSUMED, got %L', v_msg);

  -- (e) 존재하지 않는 토큰
  v_raised := false;
  begin
    perform public.complete_via_magic_token('qg-nonexistent-token-0000000000', 'qg-magic-key-0004', 'hash-M4');
  exception when others then
    v_raised := true; v_msg := sqlerrm;
  end;
  assert v_raised and v_msg = 'INVALID_TOKEN',
         format('[G3] unknown token must raise INVALID_TOKEN, got %L', v_msg);

  -- ================================================================ ④ 중복 완료 방지
  -- (a) 이미 완료된 t1 을 새 키로 재완료 -> 부작용 없음
  v_r2 := public.complete_task_and_generate_next(v_t1, 'qg-idem-key-0002', 'hash-B');
  assert (v_r2 ->> 'already_completed') = 'true' and (v_r2 -> 'next_task_id') = 'null'::jsonb,
         format('[G4] duplicate completion must be a no-op, got %s', v_r2);

  select count(*) into v_cnt from public.tasks where rule_id = v_rule;
  assert v_cnt = 2, format('[G4] duplicate completion must not create tasks, found %s', v_cnt);
  select count(*) into v_cnt from public.event_logs
   where task_id = v_t1 and event_type = 'TASK_COMPLETED';
  assert v_cnt = 1, '[G4] duplicate completion must not add a log';

  -- (b) DB 제약: 동일 task 에 완료 로그 중복 INSERT 차단
  v_raised := false;
  begin
    insert into public.event_logs (household_id, owner_id, task_id, event_type, actor_identifier)
    values (v_hid, v_uid, v_t1, 'TASK_COMPLETED', 'qg-direct-insert');
  exception when unique_violation then
    v_raised := true;
  end;
  assert v_raised, '[G4] event_logs unique index must block duplicate completion logs';

  -- (c) DB 제약: (rule_id, iteration_no) 중복 INSERT 차단
  v_raised := false;
  begin
    insert into public.tasks (household_id, owner_id, rule_id, iteration_no, title, due_date)
    values (v_hid, v_uid, v_rule, 2, 'dup iteration', date '2027-02-28');
  exception when unique_violation then
    v_raised := true;
  end;
  assert v_raised, '[G4] (rule_id, iteration_no) UNIQUE must block duplicate instances';

  -- (d) 건너뛴 Task 는 재완료 불가 + 다음 회차는 원래 예정일 기준
  v_r1 := public.skip_task_and_generate_next(v_t2, 'qg-skip-key-0001', 'hash-S1');
  assert (v_r1 ->> 'status') = 'SKIPPED', '[G4] skip must set SKIPPED';
  select due_date into v_due from public.tasks where rule_id = v_rule and iteration_no = 3;
  assert v_due = date '2027-03-31',
         format('[G4] skipped next due must derive from original due (2027-03-31), got %s', v_due);

  v_raised := false;
  begin
    perform public.complete_task_and_generate_next(v_t2, 'qg-idem-key-0003', 'hash-C');
  exception when others then
    v_raised := true; v_msg := sqlerrm;
  end;
  assert v_raised and v_msg = 'TASK_NOT_ACTIONABLE',
         format('[G4] skipped task must not be completable, got %L', v_msg);

  -- (e) 완료된 Task 는 건너뛰기 불가
  v_raised := false;
  begin
    perform public.skip_task_and_generate_next(v_t1, 'qg-skip-key-0002', 'hash-S2');
  exception when others then
    v_raised := true; v_msg := sqlerrm;
  end;
  assert v_raised and v_msg = 'TASK_NOT_ACTIONABLE',
         format('[G4] completed task must not be skippable, got %L', v_msg);

  -- ---------------------------------------------------------------- cleanup
  delete from public.event_logs       where household_id = v_hid;
  delete from public.magic_tokens     where household_id = v_hid;
  delete from public.idempotency_keys where household_id = v_hid;
  delete from public.tasks            where household_id = v_hid;
  delete from public.task_rules       where household_id = v_hid;
  delete from public.assets           where household_id = v_hid;
  delete from public.profiles         where household_id = v_hid;
  delete from public.households       where id = v_hid;
  delete from auth.users              where id = v_uid;

  raise notice 'ALL 4 QUALITY GATES PASSED (date clamping / idempotency / magic token / duplicate completion)';
end;
$$;
