# 메모 검색 성능 측정

LIKE 검색(1단계)과 MySQL FULLTEXT ngram 검색(2단계)을 같은 데이터, 같은 API로 비교했어요.
그 결과를 보고 3단계(건수 상한 + 자동 선택)를 만들어서, **가장 느린 검색이 1,337ms → 27ms**가 됐어요.

## 3단계: 건수 상한 + 자동 선택 (현재 기본값 `memoir.search.engine=auto`)

1·2단계에서 찾은 두 가지 원인을 각각 고쳤어요.

1. **전체 건수는 1,000건까지만 세요.** 화면은 "더 보기" 방식이라 정확한 전체 건수가 필요 없고, 1,000건이 넘으면 "1,000개 이상"으로 보여줘요. 다음 페이지가 있는지는 COUNT 없이 21건을 읽어서 알아내요. 마지막 페이지에서는 건수를 정확히 알아요.
2. **검색할 때마다 LIKE와 FULLTEXT 중 빠른 쪽을 골라요** (`AdaptiveMemoSearcher`).
   - 섹션이나 기간 조건이 있으면 → **LIKE**. B-tree 인덱스가 먼저 범위를 좁혀 줘요.
   - 키워드만 있으면 → 최근 메모 2,000건에서 먼저 찾아봐요. 20건 이상 나오는 흔한 단어는 **LIKE**(인덱스 순서로 읽다가 금방 멈춤), 드문 단어나 없는 단어는 **FULLTEXT**를 써요.

| 검색 | LIKE (1단계) | FULLTEXT (2단계) | LIKE + 상한 | FULLTEXT + 상한 | **auto (3단계)** |
|---|---:|---:|---:|---:|---:|
| 목록 (조건 없음) | 20.6 | 16.8 | 10.6 | 10.1 | **10.4** |
| 흔한 단어: 배포 | 213.3 | 1,306.5 | 12.7 | 884.9 | **19.3** |
| 드문 단어: 마이그레이션 | 258.6 | 17.7 | 232.6 | 18.9 | **26.5** |
| 단어 2개: 배포 오류 | 228.2 | 1,247.3 | 16.2 | 964.0 | **22.1** |
| 흔한 단어 + 섹션 | 43.1 | 1,336.5 | 12.0 | 914.3 | **11.5** |
| 흔한 단어 + 기간 1개월 | 19.8 | 1,313.3 | 12.6 | 1,014.3 | **12.9** |
| 없는 단어: 블록체인 | 222.1 | 6.0 | 200.5 | 5.2 | **12.1** |
| **가장 느린 검색** | 258.6 | 1,336.5 | 232.6 | 1,014.3 | **26.5** |

(p50, 단위 ms. 3단계 측정 때는 하위 섹션과 정렬 기능을 넣은 V3 마이그레이션이 적용된 상태예요.)

- **건수 상한만** 넣으면 흔한 단어는 빨라지지만(213 → 13ms), 드문 단어와 없는 단어는 여전히 200ms가 넘어요. 결과가 1,000건보다 적으면 끝까지 세야 하기 때문이에요.
- **자동 선택**이 그 경우를 FULLTEXT로 보내서 메워요. 드문 단어는 FULLTEXT 단독(18.9ms)보다 조금 느린데(26.5ms), 흔한 단어인지 알아보는 탐색 쿼리(최근 2,000건) 비용이에요.
- 탐색 기준(2,000건 중 20건)은 이 데이터에 맞춘 값이에요. 메모가 아주 적은 사용자는 탐색할 것도 적어서 문제없고, 단어 분포가 크게 다르면 기준을 다시 재 봐야 해요.

원본 결과: [`results/auto.json`](results/auto.json), [`results/like-capped.json`](results/like-capped.json), [`results/fulltext-capped.json`](results/fulltext-capped.json)

---

## 1·2단계 기록

## 결론

- **FULLTEXT는 "드문 단어"와 "없는 단어"에서 압도적으로 빨라요.** 259ms → 18ms(약 15배), 222ms → 6ms(약 37배)
- **하지만 "흔한 단어"에서는 6배 느려졌어요.** 213ms → 1,307ms. 섹션이나 기간을 같이 걸면 20~43ms → 1,300ms 이상으로 더 크게 느려졌어요.
- 원인은 **FULLTEXT 인덱스에 `user_id`가 없다**는 점이에요. 내 메모만 찾는데도 **모든 사용자의 메모에서 일치하는 26만 4천 건**을 먼저 꺼낸 뒤 내 것을 거르고, 그 전부를 정렬해요.
- LIKE의 비용은 대부분 검색 자체가 아니라 **전체 건수 COUNT**에서 나와요. 흔한 단어는 첫 페이지 20건을 0.15ms에 찾지만, 전체 건수를 세는 데 216ms가 들어요.
- 그래서 2단계 시점에는 기본 검색을 LIKE로 두었어요. (지금 기본값은 3단계 auto예요.)

## 결과 (p50 / p95, 단위 ms, 요청 20회)

| 검색 | 결과 건수 | LIKE | FULLTEXT | 변화 |
|---|---:|---:|---:|---|
| 목록 (조건 없음) | 100,000 | 20.6 / 23.0 | 16.8 / 18.9 | 같음 (검색어 없음) |
| 흔한 단어 1개: 배포 | 52,871 | 213.3 / 233.0 | 1,306.5 / 1,349.2 | **6.1배 느려짐** |
| 드문 단어 1개: 마이그레이션 | 95 | 258.6 / 290.6 | 17.7 / 21.6 | **14.6배 빨라짐** |
| 단어 2개: 배포 오류 | 28,962 | 228.2 / 245.7 | 1,247.3 / 1,322.2 | 5.5배 느려짐 |
| 흔한 단어 + 섹션 | 10,555 | 43.1 / 53.6 | 1,336.5 / 1,401.6 | 31배 느려짐 |
| 흔한 단어 + 기간 1개월 | 2,089 | 19.8 / 22.4 | 1,313.3 / 1,389.2 | 66배 느려짐 |
| 없는 단어: 블록체인 | 0 | 222.1 / 251.3 | 6.0 / 7.5 | **37배 빨라짐** |

결과 건수는 두 방식이 모두 같아요. `FulltextMemoSearcherTest`가 21개 검색어와 섹션, 기간 조건에서 두 방식이 같은 메모를 같은 순서로 돌려주는지 확인해요.

## 왜 그런가 (EXPLAIN ANALYZE)

**LIKE, 흔한 단어 "배포"**
- 첫 페이지: `(user_id, created_at, id)` 인덱스를 최신순으로 훑다가 20건을 채우면 멈춰요. **0.15ms**
- 전체 건수 COUNT: 내 메모 10만 건을 전부 읽어야 해요. **216ms** ← 비용의 대부분
- 드문 단어는 첫 페이지에서도 20건을 채우려면 멀리까지 읽어야 해서 40ms가 들어요.

**FULLTEXT, 흔한 단어 "배포"**
```
-> Full-text index search on memos using ft_memos_title_content
   (actual rows=264206)   ← 사용자 5명 전체의 일치 건수
-> Filter: user_id = 나   (→ 약 5만 2천 건)
-> Sort row IDs: created_at DESC, id DESC  (468ms)
```
- 기간 조건(1개월)을 붙여도 옵티마이저가 FULLTEXT 인덱스를 먼저 써요. 그래서 2천 건만 보면 될 일을 26만 건에서 시작해요.
- 같은 작업이 첫 페이지 쿼리와 COUNT 쿼리에서 두 번 일어나서 1.3초가 나와요.

## 측정하면서 발견한 함정

1. **ngram 불용어**: 기본 설정(`innodb_ft_enable_stopword=ON`)에서는 불용어 `a`가 들어간 토큰("da", "at", "ta")이 빠져서 **`data`를 검색하면 0건**이 나와요. 직접 확인했고, 그래서 V2 마이그레이션에서 인덱스를 만들 때 불용어를 꺼요.
2. **한 글자 검색어**: ngram이 2글자 단위라서 FULLTEXT로는 찾을 수 없어요. 한 글자는 LIKE로 처리해요.
3. **더미 데이터 인코딩**: `docker exec mysql`로 SQL을 넣을 때 `--default-character-set=utf8mb4`를 빼면 한글이 이중 인코딩돼서 검색이 하나도 안 걸려요.
4. **RAND와 파생 테이블 병합**: MySQL이 파생 테이블을 조인에 합치면서 `RAND()`가 후보 행마다 다시 계산돼서, 사용자별 메모 수가 정확히 10만이 아니었어요. `NO_MERGE` 힌트로 고쳤어요.

## 환경과 방법

| 항목 | 값 |
|---|---|
| 데이터 | 사용자 5명 × 메모 10만 건 = 50만 건. 메모 평균 128자, 60개 단어에서 40개를 무작위로 뽑음 (시드 고정) |
| 단어 분포 | "배포"는 메모의 약 53%에, "마이그레이션"은 0.1%에 들어감 |
| DB | MySQL 8.4 (Docker, WSL2), `innodb_buffer_pool_size` 약 1GB. 데이터 385MB가 메모리에 다 올라감 |
| FULLTEXT 인덱스 | ngram(토큰 2글자), 50만 건 생성에 1분 30초 |
| 앱 | Spring Boot 4.1, 로컬 실행, 요청 하나씩 순서대로 (동시 요청 없음) |
| 측정 | `GET /api/memos` 실제 HTTP 호출. 쿼리마다 3회 데운 뒤 20회 측정 |

한계: 노트북 한 대에서 동시 요청 없이 잰 값이라 절대 수치보다 **두 방식의 차이**를 봐야 해요. 디스크에서 읽어야 하는 상황(버퍼 풀보다 큰 데이터)은 재지 않았어요.

## 다시 재는 법

```bash
docker run -d --name memoir-bench -e MYSQL_DATABASE=memoir -e MYSQL_USER=memoir -e MYSQL_PASSWORD=memoir \
  -e MYSQL_ROOT_PASSWORD=root -p 3307:3306 mysql:8.4 --innodb-buffer-pool-size=1G
./gradlew bootRun --args='--spring.profiles.active=bench --memoir.search.engine=like'
python bench/run.py --label like --signup                                     # 측정 사용자 가입
python bench/seed.py | docker exec -i memoir-bench mysql --default-character-set=utf8mb4 -umemoir -pmemoir memoir
python bench/run.py --label like
./gradlew bootRun --args='--spring.profiles.active=bench --memoir.search.engine=fulltext'
python bench/run.py --label fulltext
./gradlew bootRun --args='--spring.profiles.active=bench'                          # 기본값 auto
python bench/run.py --label auto
```

원본 결과: [`results/like.json`](results/like.json), [`results/fulltext.json`](results/fulltext.json)
