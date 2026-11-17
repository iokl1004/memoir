package com.iokl1004.memoir.memo.search;

/** 메모 정렬. 마지막에 id를 붙여 같은 값끼리도 순서가 항상 같게 해요. 각 기준마다 (user_id, 컬럼, id) 인덱스가 있어요. */
public enum MemoSort {
    CREATED_DESC("m.created_at DESC, m.id DESC"),
    CREATED_ASC("m.created_at ASC, m.id ASC"),
    UPDATED_DESC("m.updated_at DESC, m.id DESC"),
    UPDATED_ASC("m.updated_at ASC, m.id ASC"),
    TITLE_ASC("m.title ASC, m.id ASC"),
    TITLE_DESC("m.title DESC, m.id DESC"),
    /** 사용자가 끌어서 정한 순서 */
    CUSTOM("m.position ASC, m.id ASC");

    final String orderBy;

    MemoSort(String orderBy) {
        this.orderBy = orderBy;
    }
}
