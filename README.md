# memoir

섹션을 트리로 나눠 쓰고, 키워드와 작성일로 다시 찾는 개인 메모 웹앱이에요.

- **섹션 트리**: 회사 › 프로젝트 › 회의처럼 단계 제한 없이 나눠요. 끌어서 다른 섹션 안이나 최상위로 옮겨요.
- **검색**: 제목과 본문에서 여러 단어를 함께 찾고, 섹션과 작성일 기간으로 좁혀요.
- **정렬**: 만든 날짜, 수정한 날짜, 제목, 직접 정한 순서(끌기 또는 Alt + ↑↓)
- **편집**: 저장하지 않고 떠나면 경고, Ctrl + S 저장, 목록에서 Delete 키로 지우기
- **라이트/다크 모드**, 휴대폰 화면

## 검색 성능: 50만 건에서 가장 느린 검색 1,337ms → 27ms

메모 50만 건(사용자 5명 × 10만 건)으로 세 가지 방식을 실제 API로 쟀어요.

| 검색 | LIKE | FULLTEXT ngram | **지금 (auto)** |
|---|---:|---:|---:|
| 흔한 단어 | 213ms | 1,307ms | **19ms** |
| 드문 단어 | 259ms | 18ms | **27ms** |
| 없는 단어 | 222ms | 6ms | **12ms** |
| 흔한 단어 + 섹션 | 43ms | 1,337ms | **12ms** |

- **LIKE**는 비용 대부분이 검색이 아니라 전체 건수 `COUNT`에서 나왔어요.
- **FULLTEXT**는 인덱스에 `user_id`가 없어서, 흔한 단어는 모든 사용자의 일치 26만 건을 꺼내 정렬하느라 느렸어요.
- 그래서 **건수는 1,000건까지만 세고**, 검색할 때마다 **LIKE와 FULLTEXT 중 빠른 쪽을 골라요**. 최근 메모 2,000건에서 먼저 찾아보고 흔한 단어인지 판단해요.

측정 방법, 실행 계획(EXPLAIN ANALYZE), 찾은 함정(ngram 불용어 때문에 `data` 검색이 0건이 되는 문제 등)은 [bench/README.md](bench/README.md)에 있어요.

## 기술 스택

| | |
|---|---|
| 백엔드 | Java 21, Spring Boot 4.1, Spring Security(세션 + CSRF), Spring Data JPA, Flyway |
| DB | MySQL 8.4 (FULLTEXT ngram 인덱스) |
| 프론트엔드 | React 19, TypeScript, Vite |
| 테스트 | JUnit 5, Testcontainers(MySQL) — 통합 테스트 56개 |
| 개발 환경 | Docker Compose (앱을 켜면 MySQL이 함께 떠요) |

## 구조

```
src/main/java/com/iokl1004/memoir
 ├─ auth      회원가입, 로그인 (세션), Security 설정
 ├─ section   섹션 트리: 만들기, 이름 바꾸기, 옮기기, 지우기(하위까지, 메모는 미분류로)
 └─ memo      메모 CRUD, 사용자 지정 순서
     └─ search  MemoSearcher 인터페이스 — LIKE / FULLTEXT / auto(기본값)
src/main/resources/db/migration   Flyway V1~V3
frontend/                          React 화면
bench/                             검색 성능 측정 도구와 결과
```

설계에서 신경 쓴 점
- 메모의 `(section_id, user_id)` 복합 FK로, 다른 사람의 섹션에 메모가 들어가는 일을 DB가 막아요.
- 다른 사람의 메모나 섹션은 "없음"(404)으로 응답해서 존재 여부도 알 수 없게 해요.
- 섹션 삭제(하위 섹션 + 메모 이동)와 섹션 이동(순환 검사)은 한 트랜잭션으로 처리해요.
- 사용자 지정 순서는 1024 간격으로 번호를 매기고, 사이에 끼울 자리가 없을 때만 다시 매겨요.

## 실행하기

Docker Desktop, Java 21, Node.js가 필요해요.

```bash
./gradlew bootRun                 # API 서버 :8080 (MySQL은 Docker로 자동 실행)
cd frontend && npm install && npm run dev   # 화면 :5173 (/api 요청은 8080으로 전달)
```

```bash
./gradlew test                    # 통합 테스트 (Testcontainers가 MySQL을 띄워요)
```

## 디자인

화면 디자인 시스템(색, 글꼴, 버튼, 움직임)은 [taste-skill](https://github.com/Leonxlnx/taste-skill)의 `system.css`와 `motion.css`를 썼어요(MIT, [라이선스](frontend/public/assets/LICENSE-taste-skill.txt)).
