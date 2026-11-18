-- 같은 상위 섹션 안에서 사용자가 끌어서 정하는 섹션 순서 (작을수록 위)
-- 처음에는 만든 순서대로 1024 간격으로 매겨요.
ALTER TABLE sections ADD COLUMN position BIGINT NOT NULL DEFAULT 0 AFTER parent_key;

UPDATE sections s
  JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, parent_key ORDER BY created_at, id) AS rn FROM sections) r
    ON r.id = s.id
   SET s.position = r.rn * 1024;
