package com.iokl1004.memoir.memo.search;

import com.iokl1004.memoir.memo.Memo;
import com.iokl1004.memoir.memo.MemoRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Component;

/** 1단계 검색: LIKE '%단어%'. 인덱스를 탈 수 없어서 메모가 많아지면 느려져요. memoir.search.engine=like (기본값) */
@Component
@ConditionalOnProperty(name = "memoir.search.engine", havingValue = "like", matchIfMissing = true)
public class LikeMemoSearcher implements MemoSearcher {

    private static final char ESCAPE = '!';

    private final MemoRepository memos;

    public LikeMemoSearcher(MemoRepository memos) {
        this.memos = memos;
    }

    @Override
    public Page<Memo> search(MemoSearchCondition c) {
        Specification<Memo> spec = (root, query, cb) -> cb.equal(root.get("user").get("id"), c.userId());
        if (c.sectionId() != null) {
            spec = spec.and((root, query, cb) -> cb.equal(root.get("section").get("id"), c.sectionId()));
        }
        if (c.from() != null) {
            spec = spec.and((root, query, cb) ->
                    cb.greaterThanOrEqualTo(root.get("createdAt"), c.from().atStartOfDay()));
        }
        if (c.to() != null) {
            spec = spec.and((root, query, cb) ->
                    cb.lessThan(root.get("createdAt"), c.to().plusDays(1).atStartOfDay()));
        }
        for (String term : c.terms()) {
            String pattern = "%" + escape(term) + "%";
            spec = spec.and((root, query, cb) -> cb.or(
                    cb.like(root.get("title"), pattern, ESCAPE),
                    cb.like(root.get("content"), pattern, ESCAPE)));
        }
        // (user_id, created_at, id) 인덱스와 같은 순서로 정렬해요.
        Sort newestFirst = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
        return memos.findAll(spec, PageRequest.of(c.page(), c.size(), newestFirst));
    }

    /** 사용자가 입력한 %, _ 가 와일드카드로 동작하지 않게 막아요. (MySQL에서 \ 는 따옴표와 엉켜서 ! 를 써요) */
    static String escape(String term) {
        return term.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }
}
