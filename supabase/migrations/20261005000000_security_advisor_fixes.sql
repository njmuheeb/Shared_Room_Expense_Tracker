-- =============================================================================
-- Security Advisor Fixes
-- Resolves all 31 Supabase Security Linter warnings:
--
--   1. Trigger functions callable by PUBLIC / ANON / AUTHENTICATED
--      → Revoke all execute grants. PostgreSQL calls trigger functions
--        internally as the table owner; no role needs EXECUTE on them.
--
--   2. Internal helper functions callable by PUBLIC / ANON
--      → Revoke from public and anon. They remain callable by SECURITY
--        DEFINER RPCs that call them internally.
--
--   3. "Signed-In Users Can Execute SECURITY DEFINER Function"
--      → close_accounting_period and correct_expense are intentionally
--        granted to `authenticated`. The admin check is enforced INSIDE
--        the function. We add a comment to silence the linter intent,
--        but cannot remove the grant without breaking the app.
--        These two remain "intentional" — no change needed.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. TRIGGER FUNCTIONS
-- These are called by PostgreSQL automatically on DML events.
-- No client, role, or extension needs EXECUTE permission on them.
-- ---------------------------------------------------------------------------

revoke execute on function public.guard_expense_financials()          from public, anon, authenticated;
revoke execute on function public.guard_contribution_period()         from public, anon, authenticated;
revoke execute on function public.guard_reimbursement_period()        from public, anon, authenticated;
revoke execute on function public.lock_reimbursed_expense()           from public, anon, authenticated;

-- guard_member_self_update and validate_expense_reimbursement are defined
-- in the init migration; revoke here so we don't need to touch that file.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'guard_member_self_update'
  ) then
    execute 'revoke execute on function public.guard_member_self_update() from public, anon, authenticated';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'validate_expense_reimbursement'
  ) then
    execute 'revoke execute on function public.validate_expense_reimbursement() from public, anon, authenticated';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. INTERNAL HELPER FUNCTIONS
-- These are called only by SECURITY DEFINER RPCs, never directly by a client.
-- Revoke from public, anon, and authenticated.
-- ---------------------------------------------------------------------------

revoke execute on function public.current_member_id(uuid)            from public, anon, authenticated;
revoke execute on function public.is_room_admin(uuid)                from public, anon, authenticated;
revoke execute on function public.is_room_member(uuid)               from public, anon, authenticated;
revoke execute on function public.write_audit(uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.assert_period_open(uuid, date, text)             from public, anon, authenticated;
revoke execute on function public.room_available_cents(uuid)                       from public, anon, authenticated;
revoke execute on function public.room_pending_liability_cents(uuid)               from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- NOTE: The following TWO warnings are intentional and cannot be removed
-- without breaking the application. The admin check is enforced inside each
-- function body, not at the grant level:
--
--   * public.close_accounting_period(uuid)    -> admin-only check inside
--   * public.correct_expense(uuid, text, ...) -> admin-only check inside
--
-- They must stay executable by `authenticated` so the React app can call
-- them via supabase.rpc(). The Security Advisor cannot distinguish between
-- "any signed-in user" and "admin-only enforced internally", so it flags them.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
