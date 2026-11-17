package com.iokl1004.memoir.memo.search;

/** 1단계 검색: LIKE '%단어%'. 인덱스를 탈 수 없어서 키워드만 있으면 사용자의 메모를 다 훑어요. */
public class LikeMemoSearcher implements MemoSearcher {

    private final MemoSql sql;

    public LikeMemoSearcher(MemoSql sql) {
        this.sql = sql;
    }

    @Override
    public MemoSearchResult search(MemoSearchCondition c) {
        return sql.search(c, false);
    }
}
