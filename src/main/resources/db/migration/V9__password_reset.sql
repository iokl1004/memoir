-- 비밀번호 찾기: 메일로 보낸 1회용 링크. 토큰 원문은 저장하지 않고 SHA-256 해시만 둬요(DB가 새어도 링크를 쓸 수 없게).
CREATE TABLE password_reset_tokens (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT      NOT NULL,
  token_hash  CHAR(64)    NOT NULL,
  expires_at  DATETIME(6) NOT NULL,
  used_at     DATETIME(6) NULL,
  created_at  DATETIME(6) NOT NULL,
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT uk_password_reset_token UNIQUE (token_hash),
  KEY idx_password_reset_user_created (user_id, created_at)
);
