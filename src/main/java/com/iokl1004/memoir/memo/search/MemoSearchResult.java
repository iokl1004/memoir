package com.iokl1004.memoir.memo.search;

import com.iokl1004.memoir.memo.Memo;

import java.util.List;

/**
 * @param total       결과 건수. totalCapped이면 "이 수 이상"이라는 뜻이에요.
 * @param totalCapped 결과가 너무 많아서 끝까지 세지 않았는지
 * @param hasNext     다음 페이지가 있는지 (건수와 상관없이 정확해요)
 */
public record MemoSearchResult(List<Memo> items, long total, boolean totalCapped, boolean hasNext) {
}
