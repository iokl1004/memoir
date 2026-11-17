-- 2단계 검색: 제목+본문 FULLTEXT 인덱스 (ngram 파서, 기본 2글자 단위)
-- ngram은 불용어(a, at, the ...)가 들어간 토큰을 통째로 빼기 때문에, 켜 두면 'data' 같은 영어 단어를 못 찾아요.
-- 인덱스를 만드는 세션에서만 불용어를 꺼요.
SET SESSION innodb_ft_enable_stopword = OFF;

ALTER TABLE memos
  ADD FULLTEXT INDEX ft_memos_title_content (title, content) WITH PARSER ngram;
