"""검색 성능 측정용 더미 메모를 만드는 SQL을 출력해요.

사용법 (bench DB가 3307에서 떠 있고, 측정 사용자가 API로 가입된 뒤):
    python bench/seed.py | docker exec -i memoir-bench mysql --default-character-set=utf8mb4 -umemoir -pmemoir memoir

- 측정 사용자(bench@memoir.test) 1명 + 다른 사용자 4명, 각자 메모 10만 건 = 50만 건
- 다른 사용자를 두는 이유: FULLTEXT는 user_id 인덱스와 함께 쓰이지 않아서, 남의 메모가 많을수록 느려지는지 보려고요.
- RAND(시드)마다 시드를 다르게 줘서 실행할 때마다 같은 데이터가 나와요.
"""

USERS = 5
MEMOS_PER_USER = 100_000
CONTENT_WORDS = 40
TITLE_WORDS = 3
SECTIONS = ["업무", "공부", "일상", "프로젝트"]

# 자주 나오는 단어 60개. 메모 한 건에 40개를 뽑으니 각 단어는 대략 절반의 메모에 들어가요.
WORDS = """배포 서버 오류 회의 일정 검색 성능 데이터 사용자 테스트 코드 리뷰 기획 디자인 장보기 운동 독서 여행
가계부 정리 확인 수정 요청 결과 보고서 문서 계획 목표 회고 아이디어 질문 답변 메일 전화 약속 점심 저녁 주말
버그 기능 화면 로그인 결제 알림 백업 설정 환경 캐시 쿼리 인덱스 트랜잭션 스프링 자바 리액트 도커 깃 공부 강의
산책 커피""".split()
# 드물게 나오는 단어: 메모 1,000건에 1건꼴
RARE_WORD = "마이그레이션"

assert len(WORDS) == 60


def elt(seed: int) -> str:
    words = ",".join(f"'{w}'" for w in WORDS)
    return f"ELT(1 + FLOOR(RAND({seed}) * {len(WORDS)}), {words})"


def main() -> None:
    out = []
    out.append("SET SESSION cte_max_recursion_depth = 1000000;")
    out.append("SET autocommit = 1;")
    # 다시 실행해도 되게, 측정 사용자의 가입 정보(계정과 미분류 섹션)만 남기고 지워요.
    out.append("DELETE FROM memos WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'bench%@memoir.test');")
    out.append("DELETE FROM sections WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'bench%@memoir.test') "
               "AND NOT (is_default AND user_id = (SELECT id FROM users WHERE email = 'bench@memoir.test'));")
    out.append("DELETE FROM users WHERE email LIKE 'bench-%@memoir.test';")

    # 측정 사용자는 API로 가입해서 이미 있어요. 나머지 4명은 로그인할 일이 없어서 해시 자리에 아무 값이나 넣어요.
    for i in range(2, USERS + 1):
        out.append(
            "INSERT INTO users (email, password, created_at) "
            f"VALUES ('bench-{i}@memoir.test', '{'$2a$10$' + 'x' * 53}', NOW(6));"
        )
        out.append(
            "INSERT INTO sections (user_id, name, is_default, created_at) "
            f"SELECT id, '미분류', TRUE, NOW(6) FROM users WHERE email = 'bench-{i}@memoir.test';"
        )

    for name in SECTIONS:
        out.append(
            "INSERT INTO sections (user_id, name, is_default, created_at) "
            f"SELECT id, '{name}', FALSE, NOW(6) FROM users WHERE email LIKE 'bench%@memoir.test';"
        )

    for u in range(1, USERS + 1):
        email = "bench@memoir.test" if u == 1 else f"bench-{u}@memoir.test"
        base = u * 1000  # 사용자마다 시드를 다르게
        content = ", ".join(elt(base + i) for i in range(CONTENT_WORDS))
        title = ", ".join(elt(base + 100 + i) for i in range(TITLE_WORDS))
        out.append(f"SELECT id INTO @uid FROM users WHERE email = '{email}';")
        out.append(f"""
INSERT INTO memos (user_id, section_id, title, content, created_at, updated_at)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < {MEMOS_PER_USER}),
     s AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS k FROM sections WHERE user_id = @uid)
SELECT /*+ NO_MERGE(x) */ @uid, s.id,
       CONCAT_WS(' ', {title}),
       CONCAT_WS(' ', {content}, IF(RAND({base + 300}) < 0.001, '{RARE_WORD}', NULL)),
       x.t, x.t
FROM (SELECT n, 1 + FLOOR(RAND({base + 200}) * 5) AS k,
             TIMESTAMP('2025-01-01') + INTERVAL FLOOR(RAND({base + 400}) * 730 * 86400) SECOND AS t
      FROM seq) x
JOIN s ON s.k = x.k;""")
        out.append(f"SELECT '{email}' AS user, COUNT(*) AS memos FROM memos WHERE user_id = @uid;")

    # 이름 정렬 값(V7). 더미 제목에는 숫자가 없어서 제목 그대로예요.
    out.append("UPDATE memos SET title_sort = title WHERE title_sort = '';")
    out.append("ANALYZE TABLE memos;")
    print("\n".join(out))


if __name__ == "__main__":
    main()
