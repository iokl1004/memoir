package com.iokl1004.memoir.memo.search;

import com.iokl1004.memoir.TestcontainersConfiguration;
import com.iokl1004.memoir.support.Api;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

/** 기본 검색(auto)의 방식 선택과, 1,000건에서 멈추는 건수 세기 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AdaptiveSearchTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    MemoSql sql;

    @Autowired
    MemoSearcher searcher;

    Api api;
    long userId;

    /** 메모 1,030건: 모두 "일지", 그중 3건만 "마이그레이션" */
    @BeforeEach
    void 메모를_많이_만든다() throws Exception {
        api = Api.signupAndLogin(mvc);
        userId = ((Number) JsonPath.read(api.body(get("/api/auth/me")), "$.id")).longValue();
        long sectionId = ((Number) JsonPath.read(api.body(get("/api/sections")), "$[0].id")).longValue();
        jdbc.batchUpdate("""
                INSERT INTO memos (user_id, section_id, position, title, content, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, NOW(6), NOW(6))""", java.util.stream.IntStream.range(0, 1030)
                .mapToObj(i -> new Object[]{userId, sectionId, i * 1024L, "일지 " + i,
                        i % 400 == 0 ? "마이그레이션 기록" : "평범한 기록"})
                .toList());
    }

    @Test
    void 기본_검색_방식은_auto다() {
        assertThat(searcher).isInstanceOf(AdaptiveMemoSearcher.class);
    }

    @Test
    void 흔한_단어와_필터가_있으면_LIKE_드문_단어만_있으면_FULLTEXT를_쓴다() {
        AdaptiveMemoSearcher auto = new AdaptiveMemoSearcher(sql);
        assertThat(auto.useFulltext(condition(List.of("일지"), null, null))).isFalse();          // 흔한 단어
        assertThat(auto.useFulltext(condition(List.of("마이그레이션"), null, null))).isTrue();    // 드문 단어
        assertThat(auto.useFulltext(condition(List.of("블록체인"), null, null))).isTrue();        // 없는 단어
        assertThat(auto.useFulltext(condition(List.of("마이그레이션"), Set.of(1L), null))).isFalse(); // 섹션 조건
        assertThat(auto.useFulltext(condition(List.of("마이그레이션"), null, LocalDate.now()))).isFalse(); // 기간 조건
        assertThat(auto.useFulltext(condition(List.of("록"), null, null))).isFalse();            // 한 글자
        assertThat(auto.useFulltext(condition(List.of(), null, null))).isFalse();               // 키워드 없음
    }

    @Test
    void 결과가_1000건을_넘으면_1000건_이상으로_알려준다() throws Exception {
        api.perform(get("/api/memos?q=일지"))
                .andExpect(jsonPath("$.total").value(1000))
                .andExpect(jsonPath("$.totalCapped").value(true))
                .andExpect(jsonPath("$.hasNext").value(true));
        api.perform(get("/api/memos?q=마이그레이션"))
                .andExpect(jsonPath("$.total").value(3))
                .andExpect(jsonPath("$.totalCapped").value(false))
                .andExpect(jsonPath("$.hasNext").value(false));
    }

    @Test
    void 마지막_페이지는_건수를_정확히_안다() throws Exception {
        api.perform(get("/api/memos?page=51"))   // 1,030건 = 20건 × 51쪽 + 10건
                .andExpect(jsonPath("$.items.length()").value(10))
                .andExpect(jsonPath("$.total").value(1030))
                .andExpect(jsonPath("$.totalCapped").value(false))
                .andExpect(jsonPath("$.hasNext").value(false));
    }

    private MemoSearchCondition condition(List<String> terms, Set<Long> sections, LocalDate from) {
        return new MemoSearchCondition(userId, sections, terms, from, null, null, 0, 20);
    }
}
