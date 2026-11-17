CREATE TABLE users (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  password    VARCHAR(60)  NOT NULL,
  created_at  DATETIME(6)  NOT NULL,
  UNIQUE KEY uk_users_email (email)
);

CREATE TABLE sections (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT      NOT NULL,
  name        VARCHAR(30) NOT NULL,
  is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  DATETIME(6) NOT NULL,
  UNIQUE KEY uk_sections_user_name (user_id, name),
  UNIQUE KEY uk_sections_id_user (id, user_id),
  CONSTRAINT fk_sections_user FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE memos (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT       NOT NULL,
  section_id  BIGINT       NOT NULL,
  title       VARCHAR(100) NOT NULL,
  content     MEDIUMTEXT   NOT NULL,
  created_at  DATETIME(6)  NOT NULL,
  updated_at  DATETIME(6)  NOT NULL,
  -- 메모 주인과 섹션 주인이 다르면 DB가 거부해요.
  CONSTRAINT fk_memos_section_user FOREIGN KEY (section_id, user_id) REFERENCES sections (id, user_id),
  KEY idx_memos_user_created (user_id, created_at, id),
  KEY idx_memos_user_section_created (user_id, section_id, created_at, id)
);
