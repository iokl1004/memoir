package com.iokl1004.memoir.memo.search;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;

/**
 * @param sectionId null이면 모든 섹션
 * @param terms     모든 단어가 제목이나 본문에 들어간 메모만 찾아요. 비어 있으면 키워드 조건 없음
 * @param from      작성일 시작 (포함), null이면 제한 없음
 * @param to        작성일 끝 (포함), null이면 제한 없음
 */
public record MemoSearchCondition(Long userId, Long sectionId, List<String> terms,
                                  LocalDate from, LocalDate to, int page, int size) {

    public static List<String> splitTerms(String q) {
        if (q == null || q.isBlank()) {
            return List.of();
        }
        return Arrays.stream(q.trim().split("\\s+")).distinct().toList();
    }
}
