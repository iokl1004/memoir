package com.iokl1004.memoir.memo.search;

/**
 * 2단계 검색: MySQL FULLTEXT 인덱스 (ngram 파서).
 * 단어마다 +"단어" 로 묶어서 "모든 단어 포함"과 "글자 그대로"라는 LIKE의 뜻을 그대로 지켜요.
 * 주의: 인덱스에 user_id가 없어서, 흔한 단어는 모든 사용자의 일치 건을 꺼내 정렬하느라 느려요.
 */
public class FulltextMemoSearcher implements MemoSearcher {

    private final MemoSql sql;

    public FulltextMemoSearcher(MemoSql sql) {
        this.sql = sql;
    }

    @Override
    public MemoSearchResult search(MemoSearchCondition c) {
        return sql.search(c, true);
    }
}
