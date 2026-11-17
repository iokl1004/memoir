package com.iokl1004.memoir.memo.search;

/**
 * 메모 검색 방식을 바꿔 끼울 수 있게 분리한 인터페이스예요. memoir.search.engine 으로 골라요.
 * like: LIKE만 / fulltext: FULLTEXT ngram / auto(기본): 조건과 검색어에 따라 둘 중 빠른 쪽
 * 측정 결과는 bench/README.md 에 있어요.
 */
public interface MemoSearcher {

    MemoSearchResult search(MemoSearchCondition condition);
}
