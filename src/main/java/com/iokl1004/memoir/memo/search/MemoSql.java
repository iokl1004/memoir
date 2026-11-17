package com.iokl1004.memoir.memo.search;

import com.iokl1004.memoir.memo.Memo;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 세 검색 방식이 함께 쓰는 SQL. 키워드를 LIKE로 찾을지 FULLTEXT로 찾을지만 달라요.
 * - 다음 페이지 여부는 한 건 더 읽어서 알아내요 (COUNT 없이).
 * - 전체 건수는 COUNT_CAP 건까지만 세요. 측정해 보니 LIKE 비용의 대부분이 전체 COUNT였어요.
 */
@Component
public class MemoSql {

    /** 이보다 많으면 "1,000건 이상"으로 보여줘요. */
    public static final int COUNT_CAP = 1000;
    /** MySQL ngram_token_size 기본값. 이보다 짧은 단어는 FULLTEXT로 찾을 수 없어요. */
    static final int NGRAM_SIZE = 2;

    private final EntityManager em;

    public MemoSql(EntityManager em) {
        this.em = em;
    }

    @SuppressWarnings("unchecked")
    public MemoSearchResult search(MemoSearchCondition c, boolean fulltext) {
        Where where = where(c, fulltext);

        Query select = em.createNativeQuery("SELECT m.* FROM memos m" + where.sql
                + " ORDER BY " + c.sort().orderBy + " LIMIT :limit OFFSET :offset", Memo.class);
        where.bind(select);
        select.setParameter("limit", c.size() + 1);
        select.setParameter("offset", (long) c.page() * c.size());
        List<Memo> rows = select.getResultList();

        boolean hasNext = rows.size() > c.size();
        List<Memo> items = hasNext ? rows.subList(0, c.size()) : rows;
        long seen = (long) c.page() * c.size() + items.size();
        if (!hasNext) {
            // 마지막 페이지면 전체 건수를 이미 알아요.
            return new MemoSearchResult(items, seen, false, false);
        }

        Query count = em.createNativeQuery("SELECT COUNT(*) FROM (SELECT 1 FROM memos m" + where.sql
                + " LIMIT :cap) t");
        where.bind(count);
        count.setParameter("cap", COUNT_CAP + 1);
        long total = ((Number) count.getSingleResult()).longValue();
        boolean capped = total > COUNT_CAP;
        return new MemoSearchResult(items, capped ? COUNT_CAP : Math.max(total, seen), capped, true);
    }

    /** 최근 메모 probeRows건 안에 키워드가 몇 건 있는지. 흔한 단어인지 가늠할 때 써요. */
    public long recentMatches(MemoSearchCondition c, int probeRows) {
        MemoSearchCondition keywordOnly = new MemoSearchCondition(
                c.userId(), null, c.terms(), null, null, MemoSort.CREATED_DESC, 0, 0);
        Where terms = where(keywordOnly, false);
        String recent = "SELECT m.title, m.content FROM memos m WHERE m.user_id = :userId"
                + " ORDER BY m.created_at DESC, m.id DESC LIMIT :probe";
        Query q = em.createNativeQuery("SELECT COUNT(*) FROM (" + recent + ") m WHERE 1 = 1" + terms.termSql);
        terms.bind(q);
        q.setParameter("probe", probeRows);
        return ((Number) q.getSingleResult()).longValue();
    }

    private static Where where(MemoSearchCondition c, boolean fulltext) {
        Where w = new Where();
        StringBuilder sql = new StringBuilder(" WHERE m.user_id = :userId");
        w.params.put("userId", c.userId());
        if (c.sectionIds() != null) {
            if (c.sectionIds().isEmpty()) {
                sql.append(" AND 1 = 0");
            } else {
                sql.append(" AND m.section_id IN (:sectionIds)");
                w.params.put("sectionIds", c.sectionIds());
            }
        }
        if (c.from() != null) {
            sql.append(" AND m.created_at >= :from");
            w.params.put("from", c.from().atStartOfDay());
        }
        if (c.to() != null) {
            sql.append(" AND m.created_at < :toNext");
            w.params.put("toNext", c.to().plusDays(1).atStartOfDay());
        }

        StringBuilder termSql = new StringBuilder();
        StringBuilder match = new StringBuilder();
        int i = 0;
        for (String term : c.terms()) {
            if (fulltext) {
                // 큰따옴표는 구문 경계라서 빼요. 나머지 문자(+ - * % _ 등)는 따옴표 안에서 글자 그대로 다뤄져요.
                String clean = term.replace("\"", "");
                if (clean.codePointCount(0, clean.length()) >= NGRAM_SIZE) {
                    match.append(match.isEmpty() ? "" : " ").append("+\"").append(clean).append('"');
                    continue;
                }
                if (clean.isEmpty()) {
                    continue;
                }
                term = clean; // 한 글자 단어는 FULLTEXT 토큰이 없어서 LIKE로 찾아요.
            }
            String key = "like" + i++;
            termSql.append(" AND (m.title LIKE :").append(key).append(" ESCAPE '!' OR m.content LIKE :")
                    .append(key).append(" ESCAPE '!')");
            w.params.put(key, "%" + escape(term) + "%");
        }
        if (!match.isEmpty()) {
            termSql.append(" AND MATCH(m.title, m.content) AGAINST (:ft IN BOOLEAN MODE)");
            w.params.put("ft", match.toString());
        }
        w.sql = sql.append(termSql).toString();
        w.termSql = termSql.toString();
        return w;
    }

    /** 사용자가 입력한 %, _ 가 와일드카드로 동작하지 않게 막아요. (MySQL에서 \ 는 따옴표와 엉켜서 ! 를 써요) */
    static String escape(String term) {
        return term.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    private static final class Where {
        String sql;
        String termSql;
        final Map<String, Object> params = new LinkedHashMap<>();

        void bind(Query q) {
            params.forEach((k, v) -> {
                if (q.getParameters().stream().anyMatch(p -> k.equals(p.getName()))) {
                    q.setParameter(k, v);
                }
            });
        }
    }
}
