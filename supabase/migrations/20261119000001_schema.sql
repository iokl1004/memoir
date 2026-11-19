-- memoir 스키마 (Supabase / Postgres)
-- 사용자는 Supabase Auth(auth.users)가 관리해요. 모든 테이블은 RLS로 "내 줄만" 보이게 해요.
-- 여러 줄을 함께 바꾸는 일(섹션 옮기기·지우기, 메모 일괄 처리, 검색)은 아래 함수들이 한 트랜잭션으로 해요.
-- 함수는 security invoker(기본값)라서 RLS가 그대로 적용돼요. 남의 줄은 함수 안에서도 안 보여요.

-- ------------------------------------------------------------------ 테이블

create table public.sections (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  parent_id   bigint,
  name        varchar(30) not null check (length(btrim(name)) between 1 and 30),
  is_default  boolean     not null default false,
  position    bigint      not null default 0,
  created_at  timestamptz not null default now(),
  unique (id, user_id),
  foreign key (parent_id, user_id) references public.sections (id, user_id) on delete cascade
);
-- 같은 상위 섹션 안에서 이름이 겹치면 안 돼요. (최상위끼리도: null을 같은 값으로 봐요)
create unique index sections_sibling_name on public.sections (user_id, parent_id, name) nulls not distinct;
create unique index sections_one_default on public.sections (user_id) where is_default;

create table public.memos (
  id            bigint generated always as identity primary key,
  user_id       uuid         not null default auth.uid() references auth.users on delete cascade,
  section_id    bigint       not null,
  position      bigint       not null default 0,
  title         varchar(100) not null,
  -- 이름 정렬용 값. 숫자의 자릿수를 맞춰 "9"가 "22"보다 앞에 오게 해요. (트리거가 채워요)
  title_sort    text         not null default '',
  -- 본문에서 글자만 뽑은 것. 검색과 목록 미리보기에 써요.
  content       text         not null default '' check (length(content) <= 20000),
  content_html  text         check (length(content_html) <= 200000),
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now(),
  foreign key (section_id, user_id) references public.sections (id, user_id) on delete cascade
);
create index memos_user_created  on public.memos (user_id, created_at, id);
create index memos_user_updated  on public.memos (user_id, updated_at, id);
create index memos_user_title    on public.memos (user_id, title_sort, id);
create index memos_user_position on public.memos (user_id, position, id);
create index memos_user_section  on public.memos (user_id, section_id, created_at, id);

-- 그림 파일은 Storage(images 버킷, 경로 "{user_id}/{id}")에 있고, 여기에는 주인과 크기만 적어요.
-- 메모가 지워지거나 본문에서 그림이 빠지면 memo_id가 비고, 하루 뒤 청소 함수가 파일까지 지워요.
create table public.memo_images (
  id            bigint generated always as identity primary key,
  user_id       uuid        not null references auth.users on delete cascade,
  memo_id       bigint      references public.memos on delete set null,
  content_type  varchar(20) not null,
  byte_size     int         not null,
  detached_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index memo_images_user on public.memo_images (user_id, id);
create index memo_images_orphan on public.memo_images (created_at) where memo_id is null;

-- ------------------------------------------------------------------ RLS

alter table public.sections enable row level security;
alter table public.memos enable row level security;
alter table public.memo_images enable row level security;

create policy "내 섹션" on public.sections for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "내 메모" on public.memos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- 그림 줄은 읽기만 해요. 만들기는 업로드 함수(관리자 키)가, 지우기는 청소 함수가 해요.
create policy "내 그림 보기" on public.memo_images for select to authenticated
  using (user_id = (select auth.uid()));

-- 새 테이블이 저절로 열리지 않게 해 두었으니, 필요한 것만 직접 열어요.
grant select, insert, update, delete on public.sections, public.memos to authenticated;
grant select on public.memo_images to authenticated;
grant all on public.sections, public.memos, public.memo_images to service_role;

-- ------------------------------------------------------------------ 제목 정렬 값

-- 예: "업무 일지 9" → "업무 일지 000000000009"
create function public.title_sort_key(title text) returns text
language sql immutable as $$
  select left(regexp_replace(
           regexp_replace(title, '(\d+)', '000000000000\1', 'g'),
           '0*(\d{12,})', '\1', 'g'), 255)
$$;

create function public.memos_before_write() returns trigger
language plpgsql as $$
begin
  new.title := coalesce(nullif(btrim(new.title), ''), '제목 없음');
  new.title_sort := public.title_sort_key(new.title);
  return new;
end $$;

create trigger memos_before_write before insert or update of title on public.memos
  for each row execute function public.memos_before_write();

-- ------------------------------------------------------------------ 가입하면 "미분류" 섹션

create function public.create_default_section() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sections (user_id, name, is_default) values (new.id, '미분류', true);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.create_default_section();
