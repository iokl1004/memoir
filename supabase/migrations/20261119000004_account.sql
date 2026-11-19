-- 계정 지우기 전에 패스워드를 확인해요. delete-account 함수(관리자 키)만 불러요.
create function public.check_password(p_user uuid, p_password text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select encrypted_password = extensions.crypt(p_password, encrypted_password)
                     from auth.users where id = p_user), false)
$$;
revoke execute on function public.check_password(uuid, text) from public, anon, authenticated;
grant execute on function public.check_password(uuid, text) to service_role;
