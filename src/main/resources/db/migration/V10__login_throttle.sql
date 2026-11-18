-- 로그인 시도 제한. 계정(email:...)과 접속 주소(ip:...)마다 최근 15분 동안 틀린 횟수와 잠금 시각을 둬요.
-- 가입하지 않은 이메일도 똑같이 세서, 잠기는 모습으로 가입 여부가 드러나지 않아요.
CREATE TABLE login_failures (
  throttle_key     VARCHAR(300) PRIMARY KEY,
  failures         INT          NOT NULL,
  first_failed_at  DATETIME(6)  NOT NULL,
  locked_until     DATETIME(6)  NULL,
  KEY idx_login_failures_first (first_failed_at)
);
