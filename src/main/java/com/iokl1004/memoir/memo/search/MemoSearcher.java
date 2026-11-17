package com.iokl1004.memoir.memo.search;

import com.iokl1004.memoir.memo.Memo;
import org.springframework.data.domain.Page;

/**
 * 메모 검색 방식을 바꿔 끼울 수 있게 분리한 인터페이스예요.
 * 1단계는 LIKE, 이후 FULLTEXT 등으로 구현체를 추가해 같은 조건으로 성능을 비교해요.
 */
public interface MemoSearcher {

    Page<Memo> search(MemoSearchCondition condition);
}
