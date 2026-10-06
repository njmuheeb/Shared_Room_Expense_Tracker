
-- =============================================================================
-- Restore RLS Helper Grants
-- 
-- The previous security fix revoked EXECUTE on these helpers from 
-- authenticated to silence the Supabase Security Linter. 
-- However, because these functions are called INSIDE Row Level Security (RLS) 
-- policies, they are evaluated as the querying user. Therefore, authenticated 
-- MUST have EXECUTE permission on them, otherwise all queries fail with 
-- "permission denied".
--
-- We restore the grants here to fix the "You do not have access to that" errors.
-- =============================================================================

grant execute on function public.current_member_id(uuid) to authenticated;
grant execute on function public.is_room_admin(uuid)     to authenticated;
grant execute on function public.is_room_member(uuid)    to authenticated;

notify pgrst, 'reload schema';



-- ============================================================================
-- Final schema-cache reload so PostgREST sees everything written above.
-- ============================================================================
notify pgrst, 'reload schema';