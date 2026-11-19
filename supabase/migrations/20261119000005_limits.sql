-- 1) 한 사람이 만들 수 있는 메모와 섹션 수를 제한해요.
--    무료 DB(500MB)는 모든 사용자가 함께 써서, 한 사람이 끝없이 만들면 모두가 멈춰요.
--    메모 1만 개 × 최대 2만 자라도 한 사람이 DB를 다 채우지는 못해요. 표를 직접 고쳐도 지켜져요.
create function public.limit_rows() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n bigint;
begin
  if tg_table_name = 'memos' then
    select count(*) into n from public.memos where user_id = new.user_id;
    if n >= 10000 then
      raise exception '메모는 한 사람에 10,000개까지 쓸 수 있어요. 안 쓰는 메모를 지운 뒤 다시 시도해 주세요.';
    end if;
  else
    select count(*) into n from public.sections where user_id = new.user_id;
    if n >= 1000 then
      raise exception '섹션은 한 사람에 1,000개까지 만들 수 있어요.';
    end if;
  end if;
  return new;
end $$;

create trigger memos_limit before insert on public.memos
  for each row execute function public.limit_rows();
create trigger sections_limit before insert on public.sections
  for each row execute function public.limit_rows();

-- 2) 모든 함수의 search_path를 비워요. 함수 안의 이름은 모두 스키마를 붙여 써서(public., auth., extensions.)
--    호출하는 쪽이 search_path를 바꿔도 다른 표나 함수가 끼어들 수 없어요. (Supabase 보안 점검 항목)
alter function public.title_sort_key(text) set search_path = '';
alter function public.memos_before_write() set search_path = '';
alter function public.list_sections() set search_path = '';
alter function public.create_section(text, bigint) set search_path = '';
alter function public.rename_section(bigint, text) set search_path = '';
alter function public.delete_section(bigint) set search_path = '';
alter function public.move_section(bigint, bigint, bigint) set search_path = '';
alter function public.save_memo(bigint, bigint, text, text, text) set search_path = '';
alter function public.move_memos(bigint[], bigint) set search_path = '';
alter function public.delete_memos(bigint[]) set search_path = '';
alter function public.search_memos(bigint, text, date, date, text, int, int) set search_path = '';
alter function public.image_usage() set search_path = '';

-- 3) move_memo: 쓰지 않는 변수 경고(db lint) 정리. 동작은 같아요.
create or replace function public.move_memo(p_id bigint, p_after_id bigint, p_before_id bigint)
returns void
language plpgsql set search_path = '' as $$
declare
  upper_pos bigint;
  lower_pos bigint;
begin
  if p_after_id is null and p_before_id is null then
    raise exception '옮길 자리의 위나 아래 메모를 알려 주세요.';
  end if;
  if p_id = p_after_id or p_id = p_before_id then
    raise exception '자기 자신 옆으로는 옮길 수 없어요.';
  end if;
  if (select count(*) from public.memos where id in (p_id, p_after_id, p_before_id))
     <> 1 + (p_after_id is not null)::int + (p_before_id is not null)::int then
    raise exception '메모를 찾을 수 없어요.';
  end if;

  for i in 1..2 loop
    upper_pos := (select position from public.memos where id = p_after_id);
    lower_pos := (select position from public.memos where id = p_before_id);
    if upper_pos is not null and lower_pos is not null and upper_pos >= lower_pos then
      raise exception '위 메모가 아래 메모보다 앞에 있어야 해요.';
    end if;
    if upper_pos is null then
      upper_pos := coalesce((select max(position) from public.memos where position < lower_pos and id <> p_id),
                            lower_pos - 2048);
    end if;
    if lower_pos is null then
      lower_pos := coalesce((select min(position) from public.memos where position > upper_pos and id <> p_id),
                            upper_pos + 2048);
    end if;
    if lower_pos - upper_pos >= 2 then
      update public.memos set position = upper_pos + (lower_pos - upper_pos) / 2 where id = p_id;
      return;
    end if;
    -- 자리가 없어요. 지금 순서대로 1024 간격으로 다시 매겨요.
    update public.memos m set position = r.n * 1024
      from (select id, row_number() over (order by position, id) as n from public.memos) r
     where m.id = r.id;
  end loop;
end $$;

-- 트리거 함수는 직접 부를 일이 없어요.
revoke execute on function public.limit_rows() from public, anon, authenticated;
