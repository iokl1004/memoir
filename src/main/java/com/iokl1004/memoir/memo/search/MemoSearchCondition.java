package com.iokl1004.memoir.memo.search;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

/**
 * @param sectionIds null이면 모든 섹션. 상위 섹션을 고르면 하위 섹션 id까지 들어 있어요.
 * @param terms      모든 단어가 제목이나 본문에 들어간 메모만 찾아요. 비어 있으면 키워드 조건 없음
 * @param from       작성일 시작 (포함), null이면 제한 없음
 * @param to         작성일 끝 (포함), null이면 제한 없음
 */
public record MemoSearchCondition(Long userId, Set<Long> sectionIds, List<String> terms,
                                  LocalDate from, LocalDate to, MemoSort sort, int page, int size) {

    public MemoSearchCondition {
        sort = sort == null ? MemoSort.CREATED_DESC : sort;
    }

    /** 섹션이나 기간 조건이 있으면 B-tree 인덱스가 먼저 범위를 좁혀 줘요. */
    public boolean hasIndexedFilter() {
        return sectionIds != null || from != null || to != null;
    }

    public static List<String> splitTerms(String q) {
        if (q == null || q.isBlank()) {
            return List.of();
        }
        return Arrays.stream(q.trim().split("\\s+")).distinct().toList();
    }
}
