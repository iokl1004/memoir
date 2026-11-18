-- 이름 정렬을 사람이 읽는 순서로: "업무 일지 9"가 "업무 일지 22"보다 앞에 와요.
-- 제목의 숫자를 자릿수를 맞춘 값(title_sort)으로 따로 두고 그걸로 정렬해요. 값은 앱이 계산하고, 기존 메모는 V8이 채워요.
ALTER TABLE memos
  ADD COLUMN title_sort VARCHAR(255) NOT NULL DEFAULT '' AFTER title,
  DROP KEY idx_memos_user_title,
  ADD KEY idx_memos_user_title_sort (user_id, title_sort, id);

-- 어느 메모에도 들어 있지 않은 그림이 언제부터 그랬는지. 하루가 지나면 정리 작업이 지워요.
ALTER TABLE memo_images ADD COLUMN detached_at DATETIME(6) NULL AFTER memo_id;
UPDATE memo_images SET detached_at = created_at WHERE memo_id IS NULL;
