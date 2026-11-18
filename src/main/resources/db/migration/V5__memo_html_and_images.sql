-- 본문에 글자와 그림을 섞어 쓸 수 있게 해요.
-- content_html: 편집기의 본문(HTML). 예전 메모는 NULL이고, 화면에서 content를 문단으로 바꿔 보여줘요.
-- content: 본문에서 글자만 뽑은 것. 검색(LIKE/FULLTEXT)과 목록 미리보기는 계속 이 칸을 써요.
ALTER TABLE memos ADD COLUMN content_html MEDIUMTEXT NULL AFTER content;

-- 메모에 붙여넣은 그림. 메모를 저장하면 memo_id가 채워지고, 메모가 지워지면 함께 지워져요.
CREATE TABLE memo_images (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT      NOT NULL,
  memo_id       BIGINT      NULL,
  content_type  VARCHAR(20) NOT NULL,
  byte_size     INT         NOT NULL,
  data          MEDIUMBLOB  NOT NULL,
  created_at    DATETIME(6) NOT NULL,
  CONSTRAINT fk_memo_images_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_memo_images_memo FOREIGN KEY (memo_id) REFERENCES memos (id) ON DELETE CASCADE,
  KEY idx_memo_images_user (user_id, id)
);
