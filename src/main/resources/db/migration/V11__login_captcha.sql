-- 로그인 시도 제한을 잠금 대신 캡차로 바꿔서, 잠금 시각은 쓰지 않아요.
ALTER TABLE login_failures DROP COLUMN locked_until;
