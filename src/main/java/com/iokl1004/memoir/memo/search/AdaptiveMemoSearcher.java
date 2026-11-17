package com.iokl1004.memoir.memo.search;

/**
 * 3단계 검색(기본값): 측정 결과(bench/README.md)를 보고 LIKE와 FULLTEXT 중 빠른 쪽을 골라요.
 * <ul>
 *   <li>키워드가 없거나, 섹션·기간 조건이 있으면 → LIKE. B-tree 인덱스가 먼저 범위를 좁혀 줘요.
 *       FULLTEXT는 이때도 전체 사용자의 일치 건부터 꺼내서 31~66배 느렸어요.</li>
 *   <li>키워드만 있으면 → 최근 메모 PROBE_ROWS건에서 먼저 찾아봐요.
 *       PROBE_MIN_HITS건 이상 나오는 흔한 단어는 LIKE가 인덱스 순서대로 읽다가 금방 멈추고,
 *       드문 단어나 없는 단어는 FULLTEXT가 훨씬 빨라요(15~37배).</li>
 * </ul>
 */
public class AdaptiveMemoSearcher implements MemoSearcher {

    static final int PROBE_ROWS = 2000;
    static final int PROBE_MIN_HITS = 20;

    private final MemoSql sql;

    public AdaptiveMemoSearcher(MemoSql sql) {
        this.sql = sql;
    }

    @Override
    public MemoSearchResult search(MemoSearchCondition c) {
        return sql.search(c, useFulltext(c));
    }

    boolean useFulltext(MemoSearchCondition c) {
        if (c.terms().isEmpty() || c.hasIndexedFilter()) {
            return false;
        }
        boolean anyLongTerm = c.terms().stream()
                .anyMatch(t -> t.replace("\"", "").codePointCount(0, t.replace("\"", "").length()) >= MemoSql.NGRAM_SIZE);
        return anyLongTerm && sql.recentMatches(c, PROBE_ROWS) < PROBE_MIN_HITS;
    }
}
