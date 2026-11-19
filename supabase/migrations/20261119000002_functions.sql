-- 여러 줄을 함께 다루는 일. 화면은 supabase.rpc('이름', {...})로 불러요.
-- 오류 메시지는 화면에 그대로 보여 줘요.

-- ------------------------------------------------------------------ 섹션 규칙 (표를 직접 고쳐도 지켜져요)

-- 계정이 지워졌는지 auth.users를 봐야 해서 security definer로 돌아요.
create function public.sections_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cur bigint;
begin
  if tg_op = 'DELETE' then
    -- 계정을 지울 때(auth.users 삭제가 연쇄로 지울 때)는 미분류도 지워져야 해요.
    if old.is_default and exists (select 1 from auth.users where id = old.user_id) then
      raise exception '미분류 섹션은 이름을 바꾸거나 삭제할 수 없어요.';
    end if;
    return old;
  end if;

  new.name := btrim(new.name);
  if tg_op = 'UPDATE' and old.is_default
     and (new.name <> old.name or new.parent_id is not null or not new.is_default) then
    raise exception '미분류 섹션은 이름을 바꾸거나 옮길 수 없어요.';
  end if;
  if tg_op = 'UPDATE' and new.is_default and not old.is_default then
    raise exception '미분류 섹션은 하나만 있어요.';
  end if;
  if tg_op = 'INSERT' and new.is_default and new.parent_id is not null then
    raise exception '미분류 섹션은 최상위에만 있어요.';
  end if;

  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    if exists (select 1 from public.sections where id = new.parent_id and is_default) then
      raise exception '미분류 안에는 섹션을 넣을 수 없어요.';
    end if;
    -- 자기 자신이나 자기 하위 섹션 안으로는 옮길 수 없어요(순환).
    cur := new.parent_id;
    while cur is not null loop
      if cur = new.id then
        raise exception '자기 자신이나 하위 섹션 안으로는 옮길 수 없어요.';
      end if;
      select parent_id into cur from public.sections where id = cur;
    end loop;
  end if;
  return new;
end $$;

create trigger sections_guard before insert or update or delete on public.sections
  for each row execute function public.sections_guard();

-- ------------------------------------------------------------------ 섹션

-- memo_count는 이 섹션에 바로 쓴 메모 수예요. 하위까지 합친 수는 화면(sectionTree.ts)이 계산해요.
create function public.list_sections()
returns table (id bigint, parent_id bigint, name varchar, is_default boolean, memo_count bigint, created_at timestamptz)
language sql stable as $$
  select s.id, s.parent_id, s.name, s.is_default,
         (select count(*) from public.memos m where m.section_id = s.id),
         s.created_at
    from public.sections s
   order by s.is_default desc, s.position, s.id
$$;

create function public.create_section(p_name text, p_parent_id bigint)
returns public.sections
language plpgsql as $$
declare
  row public.sections;
begin
  if p_parent_id is not null and not exists (select 1 from public.sections where id = p_parent_id) then
    raise exception '섹션을 찾을 수 없어요.';
  end if;
  insert into public.sections (name, parent_id, position)
  values (p_name, p_parent_id,
          coalesce((select max(position) from public.sections
                     where parent_id is not distinct from p_parent_id), 0) + 1024)
  returning * into row;
  return row;
exception when unique_violation then
  raise exception '같은 위치에 같은 이름의 섹션이 이미 있어요.';
end $$;

create function public.rename_section(p_id bigint, p_name text)
returns public.sections
language plpgsql as $$
declare
  row public.sections;
begin
  update public.sections set name = p_name where id = p_id returning * into row;
  if row.id is null then
    raise exception '섹션을 찾을 수 없어요.';
  end if;
  return row;
exception when unique_violation then
  raise exception '같은 위치에 같은 이름의 섹션이 이미 있어요.';
end $$;

-- 하위 섹션과 그 안의 메모도 함께 지워요(외래 키 on delete cascade).
create function public.delete_section(p_id bigint)
returns void
language plpgsql as $$
begin
  delete from public.sections where id = p_id;
  if not found then
    raise exception '섹션을 찾을 수 없어요.';
  end if;
end $$;

-- 섹션을 다른 섹션 안으로(p_parent_id), 또는 최상위로(null) 옮겨요. 하위 섹션과 메모는 함께 따라가요.
-- p_before_id를 주면 옮길 곳에서 그 섹션 바로 위에, 없으면 맨 아래에 놓아요.
create function public.move_section(p_id bigint, p_parent_id bigint, p_before_id bigint default null)
returns public.sections
language plpgsql as $$
declare
  row public.sections;
  ids bigint[];
  idx int;
begin
  select * into row from public.sections where id = p_id;
  if row.id is null then
    raise exception '섹션을 찾을 수 없어요.';
  end if;
  if row.is_default then
    raise exception '미분류 섹션은 옮길 수 없어요.';
  end if;
  if p_parent_id is not null and not exists (select 1 from public.sections where id = p_parent_id) then
    raise exception '섹션을 찾을 수 없어요.';
  end if;

  -- 옮길 곳의 형제 섹션 사이에 끼우고, 형제 순서를 1024 간격으로 다시 매겨요. (형제는 많지 않아요)
  select coalesce(array_agg(s.id order by s.position, s.id), '{}') into ids
    from public.sections s
   where s.parent_id is not distinct from p_parent_id and s.id <> p_id and not s.is_default;
  if p_before_id is null then
    ids := ids || p_id;
  else
    idx := array_position(ids, p_before_id);
    if idx is null then
      raise exception '옮길 곳에 그 섹션이 없어요.';
    end if;
    ids := ids[1:idx - 1] || p_id || ids[idx:];
  end if;

  update public.sections set parent_id = p_parent_id where id = p_id and parent_id is distinct from p_parent_id;
  update public.sections s set position = o.n * 1024
    from unnest(ids) with ordinality as o(id, n)
   where s.id = o.id;

  select * into row from public.sections where id = p_id;
  return row;
exception when unique_violation then
  raise exception '같은 위치에 같은 이름의 섹션이 이미 있어요.';
end $$;

-- ------------------------------------------------------------------ 메모

-- 본문에 있는 그림(<img src="/img/{id}">)은 이 메모에 묶고, 본문에서 빠진 그림은 떼어 둬요(하루 뒤 청소).
-- memo_images는 화면이 직접 고칠 수 없어서 security definer로 돌고, 주인을 직접 확인해요.
create function public.sync_memo_images(p_memo_id bigint, p_html text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ids bigint[];
begin
  if not exists (select 1 from public.memos where id = p_memo_id and user_id = uid) then
    raise exception '메모를 찾을 수 없어요.';
  end if;
  select coalesce(array_agg(distinct m[1]::bigint), '{}') into ids
    from regexp_matches(coalesce(p_html, ''), 'src="/img/(\d{1,18})"', 'g') as m;

  update public.memo_images set memo_id = null, detached_at = now()
   where memo_id = p_memo_id and not (id = any (ids));
  update public.memo_images set memo_id = p_memo_id, detached_at = null
   where user_id = uid and memo_id is null and id = any (ids);
end $$;
revoke execute on function public.sync_memo_images(bigint, text) from public, anon;

-- 메모를 만들거나(p_id가 null) 고쳐요. p_section_id가 null이면 미분류에 넣어요.
-- p_text는 편집기가 뽑은 글자예요(검색·미리보기용).
create function public.save_memo(p_id bigint, p_section_id bigint, p_title text, p_html text, p_text text)
returns public.memos
language plpgsql as $$
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
    -- 새 메모는 사용자가 정한 순서에서도 맨 위에 와요.
    insert into public.memos (section_id, position, title, content, content_html)
    values (section, coalesce((select min(position) from public.memos), 0) - 1024,
            coalesce(p_title, ''), coalesce(p_text, ''), p_html)
    returning * into row;
  else
    update public.memos
       set section_id = section, title = coalesce(p_title, ''), content = coalesce(p_text, ''),
           content_html = p_html, updated_at = now()
     where id = p_id
    returning * into row;
    if row.id is null then
      raise exception '메모를 찾을 수 없어요.';
    end if;
  end if;
  perform public.sync_memo_images(row.id, p_html);
  return row;
end $$;

-- 고른 메모를 한 섹션으로 옮겨요. 하나라도 내 메모가 아니면 아무것도 바꾸지 않아요.
create function public.move_memos(p_ids bigint[], p_section_id bigint)
returns void
language plpgsql as $$
begin
  if not exists (select 1 from public.sections where id = p_section_id) then
    raise exception '섹션을 찾을 수 없어요.';
  end if;
  if (select count(*) from public.memos where id = any (p_ids)) <> cardinality(array(select distinct unnest(p_ids))) then
    raise exception '메모를 찾을 수 없어요.';
  end if;
  update public.memos set section_id = p_section_id, updated_at = now()
   where id = any (p_ids) and section_id <> p_section_id;
end $$;

create function public.delete_memos(p_ids bigint[])
returns void
language plpgsql as $$
begin
  if (select count(*) from public.memos where id = any (p_ids)) <> cardinality(array(select distinct unnest(p_ids))) then
    raise exception '메모를 찾을 수 없어요.';
  end if;
  delete from public.memos where id = any (p_ids);
end $$;

-- 메모를 p_after_id 메모 바로 아래, p_before_id 메모 바로 위로 옮겨요(끌어 놓은 자리의 위아래 메모).
-- 사이에 끼울 자리가 없으면 순서 값을 다시 매긴 뒤 끼워요. 순서만 바뀌어서 수정일은 그대로예요.
create function public.move_memo(p_id bigint, p_after_id bigint, p_before_id bigint)
returns void
language plpgsql as $$
declare
  upper_pos bigint;
  lower_pos bigint;
  attempt int;
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

  for attempt in 1..2 loop
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

-- ------------------------------------------------------------------ 검색

-- 모든 단어가 제목이나 본문에 들어간 메모를 찾아요. 기간은 한국 날짜 기준이에요(끝 날짜 포함).
-- 다음 페이지 여부는 한 건 더 읽어서 알고, 전체 건수는 1,000건까지만 세요.
create function public.search_memos(
  p_section_id bigint default null, p_q text default null,
  p_from date default null, p_to date default null,
  p_sort text default 'CREATED_DESC', p_page int default 0, p_size int default 20)
returns jsonb
language plpgsql stable as $$
declare
  terms text[] := array(select distinct t from regexp_split_to_table(btrim(coalesce(p_q, '')), '\s+') t where t <> '');
  order_by text;
  rows jsonb;
  n int;
  total bigint;
  cap constant int := 1000;
  base text := 'from public.memos m where true';
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

-- ------------------------------------------------------------------ 그림 공간

create function public.image_usage()
returns bigint
language sql stable as $$
  select coalesce(sum(byte_size), 0) from public.memo_images
$$;

-- 함수는 로그인한 사용자만 불러요.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.list_sections(), public.create_section(text, bigint), public.rename_section(bigint, text),
  public.delete_section(bigint), public.move_section(bigint, bigint, bigint),
  public.save_memo(bigint, bigint, text, text, text), public.move_memos(bigint[], bigint),
  public.delete_memos(bigint[]), public.move_memo(bigint, bigint, bigint),
  public.search_memos(bigint, text, date, date, text, int, int), public.image_usage()
  to authenticated;
-- 다른 함수와 트리거가 안에서 부르는 함수예요.
grant execute on function public.sync_memo_images(bigint, text), public.title_sort_key(text) to authenticated;
