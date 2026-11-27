-- 휴지통과 핀(상단 고정)
-- 1) 메모를 지우면 바로 없애지 않고 휴지통(deleted_at)에 30일 둬요. 매일 청소 함수(cleanup-images)가 30일 지난 것을 지워요.
--    섹션을 지우면 안의 메모는 미분류로 옮겨 휴지통에 넣어요. 그래서 섹션을 잘못 지워도 메모는 되살릴 수 있어요.
-- 2) pinned인 메모는 목록 맨 위에 와요. 순서만 바뀌는 일이라 수정일은 그대로예요.
-- 화면은 이 기기 저장소에서 목록을 계산하고(offline.ts), 여기 함수와 같은 규칙을 따라요.

alter table public.memos
  add column pinned boolean not null default false,
  add column deleted_at timestamptz;
create index memos_user_trash on public.memos (user_id, deleted_at) where deleted_at is not null;
create index memos_trash_old on public.memos (deleted_at) where deleted_at is not null;

-- 섹션의 메모 수는 휴지통에 없는 것만 세요.
create or replace function public.list_sections()
returns table (id bigint, parent_id bigint, name varchar, is_default boolean, memo_count bigint, created_at timestamptz)
language sql stable set search_path = '' as $$
  select s.id, s.parent_id, s.name, s.is_default,
         (select count(*) from public.memos m where m.section_id = s.id and m.deleted_at is null),
         s.created_at
    from public.sections s
   order by s.is_default desc, s.position, s.id
$$;

-- 지우기 = 휴지통으로. 이미 휴지통에 있는 메모는 그대로 둬요.
create or replace function public.delete_memos(p_ids bigint[])
returns void
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.memos where id = any (p_ids)) <> cardinality(array(select distinct unnest(p_ids))) then
    raise exception '메모를 찾을 수 없어요.';
  end if;
  update public.memos set deleted_at = now() where id = any (p_ids) and deleted_at is null;
end $$;

-- 휴지통에서 되살려요.
create function public.restore_memos(p_ids bigint[])
returns void
language plpgsql set search_path = '' as $$
begin
  update public.memos set deleted_at = null where id = any (p_ids) and deleted_at is not null;
end $$;

-- 휴지통에서 완전히 지워요. 휴지통에 없는 메모는 건드리지 않아요. 그림은 떼어져서 하루 뒤 청소돼요.
create function public.purge_memos(p_ids bigint[])
returns void
language plpgsql set search_path = '' as $$
begin
  delete from public.memos where id = any (p_ids) and deleted_at is not null;
end $$;

create function public.pin_memos(p_ids bigint[], p_pinned boolean)
returns void
language plpgsql set search_path = '' as $$
begin
  update public.memos set pinned = p_pinned where id = any (p_ids) and pinned <> p_pinned;
end $$;

-- 섹션을 지우면 하위 섹션까지 지우되, 안의 메모는 미분류로 옮겨 휴지통에 넣어요.
create or replace function public.delete_section(p_id bigint)
returns void
language plpgsql set search_path = '' as $$
declare
  ids bigint[];
begin
  if not exists (select 1 from public.sections where id = p_id) then
    raise exception '섹션을 찾을 수 없어요.';
  end if;
  with recursive tree as (
    select id from public.sections where id = p_id
    union all
    select s.id from public.sections s join tree t on s.parent_id = t.id
  )
  select array_agg(id) into ids from tree;
  update public.memos
     set section_id = (select id from public.sections where is_default),
         deleted_at = coalesce(deleted_at, now())
   where section_id = any (ids);
  delete from public.sections where id = p_id;
end $$;

-- 고치면 휴지통에서 나와요. (다른 기기에서 지운 사이 이 기기에서 고친 내용을 잃지 않게)
create or replace function public.save_memo(p_id bigint, p_section_id bigint, p_title text, p_html text, p_text text)
returns public.memos
language plpgsql set search_path = '' as $$
declare
  row public.memos;
  section bigint := coalesce(p_section_id, (select id from public.sections where is_default));
begin
  if not exists (select 1 from public.sections where id = section) then
    raise exception '섹션을 찾을 수 없어요.';
  end if;
  if length(coalesce(p_text, '')) > 20000 then
    raise exception '본문은 20,000자까지 쓸 수 있어요.';
  end if;
  if length(coalesce(p_title, '')) > 100 then
    raise exception '제목은 100자까지 쓸 수 있어요.';
  end if;

  if p_id is null then
    insert into public.memos (section_id, position, title, content, content_html)
    values (section, coalesce((select min(position) from public.memos), 0) - 1024,
            coalesce(p_title, ''), coalesce(p_text, ''), p_html)
    returning * into row;
  else
    update public.memos
       set section_id = section, title = coalesce(p_title, ''), content = coalesce(p_text, ''),
           content_html = p_html, updated_at = now(), deleted_at = null
     where id = p_id
    returning * into row;
    if row.id is null then
      raise exception '메모를 찾을 수 없어요.';
    end if;
  end if;
  perform public.sync_memo_images(row.id, p_html);
  return row;
end $$;

-- 검색에서 휴지통 메모를 빼요. (나머지는 그대로)
create or replace function public.search_memos(
  p_section_id bigint default null, p_q text default null,
  p_from date default null, p_to date default null,
  p_sort text default 'CREATED_DESC', p_page int default 0, p_size int default 20)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  terms text[] := array(select distinct t from regexp_split_to_table(btrim(coalesce(p_q, '')), '\s+') t where t <> '');
  order_by text;
  rows jsonb;
  n int;
  total bigint;
  cap constant int := 1000;
  base text := 'from public.memos m where m.deleted_at is null';
begin
  if p_size < 1 or p_size > 50 or p_page < 0 then
    raise exception '입력한 내용을 다시 확인해 주세요.';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception '시작일이 종료일보다 늦어요.';
  end if;
  order_by := case p_sort
    when 'CREATED_DESC' then 'm.created_at desc, m.id desc'
    when 'CREATED_ASC'  then 'm.created_at asc, m.id asc'
    when 'UPDATED_DESC' then 'm.updated_at desc, m.id desc'
    when 'UPDATED_ASC'  then 'm.updated_at asc, m.id asc'
    when 'TITLE_ASC'    then 'm.title_sort asc, m.id asc'
    when 'TITLE_DESC'   then 'm.title_sort desc, m.id desc'
    when 'CUSTOM'       then 'm.position asc, m.id asc'
  end;
  if order_by is null then
    raise exception '정렬 기준을 다시 확인해 주세요.';
  end if;

  if p_section_id is not null then base := base || ' and m.section_id = $1'; end if;
  if p_from is not null then base := base || ' and m.created_at >= ($2::timestamp at time zone ''Asia/Seoul'')'; end if;
  if p_to is not null then base := base || ' and m.created_at < (($3 + 1)::timestamp at time zone ''Asia/Seoul'')'; end if;
  -- 사용자가 입력한 %, _ 가 와일드카드로 동작하지 않게 막아요.
  for i in 1..coalesce(array_length(terms, 1), 0) loop
    base := base || format(' and (m.title ilike %1$L escape ''\'' or m.content ilike %1$L escape ''\'')',
                           '%' || replace(replace(replace(terms[i], '\', '\\'), '%', '\%'), '_', '\_') || '%');
  end loop;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
        ''id'', m.id, ''sectionId'', m.section_id, ''title'', m.title,
        ''preview'', left(btrim(regexp_replace(m.content, ''\s+'', '' '', ''g'')), 100),
        ''createdAt'', m.created_at, ''updatedAt'', m.updated_at)), ''[]'')
       from (select m.* %s order by %s limit %s offset %s) m',
    base, order_by, p_size + 1, p_page * p_size)
    into rows using p_section_id, p_from, p_to;

  n := jsonb_array_length(rows);
  if n > p_size then
    execute format('select count(*) from (select 1 %s limit %s) t', base, cap + 1)
      into total using p_section_id, p_from, p_to;
    return jsonb_build_object('items', rows - p_size, 'page', p_page,
      'total', least(total, cap), 'totalCapped', total > cap, 'hasNext', true);
  end if;
  return jsonb_build_object('items', rows, 'page', p_page,
    'total', p_page * p_size + n, 'totalCapped', false, 'hasNext', false);
end $$;

revoke execute on function public.restore_memos(bigint[]), public.purge_memos(bigint[]), public.pin_memos(bigint[], boolean) from public, anon;
grant execute on function public.restore_memos(bigint[]), public.purge_memos(bigint[]), public.pin_memos(bigint[], boolean) to authenticated;
