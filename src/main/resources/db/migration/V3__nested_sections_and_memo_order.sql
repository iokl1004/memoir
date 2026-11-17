-- 1) 섹션 안에 섹션 (단계 제한 없음)
--    부모도 같은 사용자의 섹션이어야 해서 (parent_id, user_id) 복합 FK를 걸어요.
--    이름은 같은 부모 아래에서만 겹치면 안 돼요. MySQL 유니크 키는 NULL을 서로 다른 값으로 보기 때문에
--    최상위(parent_id NULL)끼리도 막으려고 parent_key = COALESCE(parent_id, 0) 생성 컬럼을 써요.
ALTER TABLE sections
  ADD COLUMN parent_id BIGINT NULL AFTER user_id,
  ADD COLUMN parent_key BIGINT AS (COALESCE(parent_id, 0)) STORED AFTER parent_id;

ALTER TABLE sections
  ADD UNIQUE KEY uk_sections_user_parent_name (user_id, parent_key, name),
  ADD CONSTRAINT fk_sections_parent FOREIGN KEY (parent_id, user_id) REFERENCES sections (id, user_id);

ALTER TABLE sections DROP INDEX uk_sections_user_name;

-- 2) 사용자가 끌어서 정하는 메모 순서 (사용자마다 하나의 순서, 작을수록 위)
--    1024 간격으로 번호를 매겨 두고, 사이에 끼울 자리가 없을 때만 다시 번호를 매겨요.
ALTER TABLE memos ADD COLUMN position BIGINT NOT NULL DEFAULT 0 AFTER section_id;

UPDATE memos m
  JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn FROM memos) r
    ON r.id = m.id
   SET m.position = r.rn * 1024;

-- 3) 정렬 기준마다 (user_id, 정렬 컬럼, id) 인덱스: 첫 페이지를 정렬 없이 인덱스 순서로 읽게 해요.
ALTER TABLE memos
  ADD KEY idx_memos_user_position (user_id, position, id),
  ADD KEY idx_memos_user_updated (user_id, updated_at, id),
  ADD KEY idx_memos_user_title (user_id, title, id);
