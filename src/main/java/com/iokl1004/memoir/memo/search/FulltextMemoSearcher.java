package com.iokl1004.memoir.memo.search;

import com.iokl1004.memoir.memo.Memo;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 2단계 검색: MySQL FULLTEXT 인덱스 (ngram 파서). memoir.search.engine=fulltext
 * 단어마다 +"단어" 로 묶어서 "모든 단어 포함"과 "글자 그대로"라는 LIKE의 뜻을 그대로 지켜요.
 */
@Component
@ConditionalOnProperty(name = "memoir.search.engine", havingValue = "fulltext")
public class FulltextMemoSearcher implements MemoSearcher {

    /** MySQL ngram_token_size 기본값. 이보다 짧은 단어는 FULLTEXT로 찾을 수 없어요. */
    private static final int NGRAM_SIZE = 2;

    private final EntityManager em;

    public FulltextMemoSearcher(EntityManager em) {
        this.em = em;
    }

    @Override
    @SuppressWarnings("unchecked")
    public Page<Memo> search(MemoSearchCondition c) {
        StringBuilder where = new StringBuilder(" WHERE m.user_id = :userId");
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("userId", c.userId());
        if (c.sectionId() != null) {
            where.append(" AND m.section_id = :sectionId");
            params.put("sectionId", c.sectionId());
        }
        if (c.from() != null) {
            where.append(" AND m.created_at >= :from");
            params.put("from", c.from().atStartOfDay());
        }
        if (c.to() != null) {
            where.append(" AND m.created_at < :toNext");
            params.put("toNext", c.to().plusDays(1).atStartOfDay());
        }

        List<String> phrases = new ArrayList<>();
        int i = 0;
        for (String term : c.terms()) {
            // 큰따옴표는 구문 경계라서 빼요. 나머지 문자(+ - * % _ 등)는 따옴표 안에서 글자 그대로 다뤄져요.
            String clean = term.replace("\"", "");
            if (clean.isEmpty()) {
                continue;
            }
            if (clean.codePointCount(0, clean.length()) < NGRAM_SIZE) {
                // 한 글자 단어는 FULLTEXT 토큰이 없어서 LIKE로 찾아요.
                String key = "like" + i++;
                where.append(" AND (m.title LIKE :").append(key).append(" ESCAPE '!' OR m.content LIKE :")
                        .append(key).append(" ESCAPE '!')");
                params.put(key, "%" + LikeMemoSearcher.escape(clean) + "%");
            } else {
                phrases.add("+\"" + clean + "\"");
            }
        }
        if (!phrases.isEmpty()) {
            where.append(" AND MATCH(m.title, m.content) AGAINST (:ft IN BOOLEAN MODE)");
            params.put("ft", String.join(" ", phrases));
        }

        Query select = em.createNativeQuery(
                "SELECT m.* FROM memos m" + where + " ORDER BY m.created_at DESC, m.id DESC LIMIT :size OFFSET :offset",
                Memo.class);
        Query count = em.createNativeQuery("SELECT COUNT(*) FROM memos m" + where);
        params.forEach((k, v) -> {
            select.setParameter(k, v);
            count.setParameter(k, v);
        });
        select.setParameter("size", c.size());
        select.setParameter("offset", (long) c.page() * c.size());

        List<Memo> content = select.getResultList();
        long total = ((Number) count.getSingleResult()).longValue();
        return new PageImpl<>(content, PageRequest.of(c.page(), c.size()), total);
    }
}
