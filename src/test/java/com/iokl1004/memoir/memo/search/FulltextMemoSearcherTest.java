package com.iokl1004.memoir.memo.search;

import com.iokl1004.memoir.TestcontainersConfiguration;
import com.iokl1004.memoir.memo.Memo;
import com.iokl1004.memoir.memo.MemoRepository;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** FULLTEXT 검색이 LIKE 검색과 같은 메모를 같은 순서로 돌려주는지 확인해요. */
@SpringBootTest(properties = "memoir.search.engine=fulltext")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class FulltextMemoSearcherTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    MemoSearcher searcher;

    @Autowired
    MemoRepository memos;

    @Autowired
    JdbcTemplate jdbc;

    MockHttpSession session;
    long userId;
    long workId;

    @BeforeEach
    void 메모를_준비한다() throws Exception {
        session = signupAndLogin();
        userId = ((Number) JsonPath.read(body(get("/api/auth/me")), "$.id")).longValue();
        workId = ((Number) JsonPath.read(body(post("/api/sections").with(csrf())
                .contentType(MediaType.APPLICATION_JSON).content("{\"name\": \"업무\"}")), "$.id")).longValue();

        create(workId, "배포 회고", "서버 오류가 있었다. 원인은 환경 변수 설정 누락");
        create(workId, "배포 체크리스트", "마이그레이션 실행, 헬스 체크");
        create(null, "Deploy note", "Data pipeline 정리, 데이터 백업");
        create(null, "할인 50% 쿠폰", "file_name 규칙과 회의 메모");
        create(null, "회식 장소", "강남역 근처, 목요일 저녁");
        create(null, "따옴표 \\\"인용\\\" 테스트", "+더하기 -빼기 *별표 기호");
        jdbc.update("UPDATE memos SET created_at = '2026-03-15 10:00:00' WHERE user_id = ? AND title = '배포 회고'", userId);
    }

    @Test
    void 여러_검색어에서_LIKE와_같은_결과를_낸다() {
        List<String> queries = List.of("배포", "배포 오류", "오류 배포", "deploy", "DATA", "data pipeline", "데이터",
                "%", "50%", "_", "file_name", "회", "회 배포", "마이그레이션", "+더하기", "-빼기", "*별표",
                "\"인용\"", "인용", "배");
        LikeMemoSearcher like = new LikeMemoSearcher(memos);

        for (String q : queries) {
            MemoSearchCondition c = new MemoSearchCondition(userId, null, MemoSearchCondition.splitTerms(q),
                    null, null, 0, 20);
            assertThat(titles(searcher.search(c).getContent()))
                    .as("검색어 [%s]", q)
                    .isNotEmpty()
                    .containsExactlyElementsOf(titles(like.search(c).getContent()));
        }
    }

    @Test
    void 섹션과_기간_조건도_LIKE와_같다() {
        LikeMemoSearcher like = new LikeMemoSearcher(memos);
        List<MemoSearchCondition> conditions = List.of(
                new MemoSearchCondition(userId, workId, List.of("배포"), null, null, 0, 20),
                new MemoSearchCondition(userId, null, List.of("배포"), LocalDate.of(2026, 3, 1), LocalDate.of(2026, 3, 31), 0, 20),
                new MemoSearchCondition(userId, null, List.of("배포"), LocalDate.of(2026, 4, 1), null, 0, 20));

        for (MemoSearchCondition c : conditions) {
            assertThat(titles(searcher.search(c).getContent()))
                    .as("조건 %s", c)
                    .containsExactlyElementsOf(titles(like.search(c).getContent()));
            assertThat(searcher.search(c).getTotalElements()).isEqualTo(like.search(c).getTotalElements());
        }
    }

    @Test
    void 다른_사람의_메모는_찾지_않는다() throws Exception {
        session = signupAndLogin();
        create(null, "배포 회고", "남의 메모");

        MemoSearchCondition c = new MemoSearchCondition(userId, null, List.of("배포"), null, null, 0, 20);
        assertThat(searcher.search(c).getTotalElements()).isEqualTo(2);
    }

    @Test
    void 없는_단어는_둘_다_0건() {
        MemoSearchCondition c = new MemoSearchCondition(userId, null, List.of("블록체인"), null, null, 0, 20);
        assertThat(searcher.search(c).getTotalElements()).isZero();
        assertThat(new LikeMemoSearcher(memos).search(c).getTotalElements()).isZero();
    }

    private static List<String> titles(List<Memo> list) {
        return list.stream().map(Memo::getTitle).toList();
    }

    private void create(Long sectionId, String title, String content) throws Exception {
        mvc.perform(post("/api/memos").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sectionId\": %s, \"title\": \"%s\", \"content\": \"%s\"}"
                                .formatted(sectionId, title, content)))
                .andExpect(status().isCreated());
    }

    private String body(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.session(session)).andReturn().getResponse().getContentAsString();
    }

    private MockHttpSession signupAndLogin() throws Exception {
        String credentials = """
                {"email": "user-%s@example.com", "password": "password123!"}
                """.formatted(UUID.randomUUID());
        mvc.perform(post("/api/auth/signup").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(credentials))
                .andExpect(status().isCreated());
        return (MockHttpSession) mvc.perform(post("/api/auth/login").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(credentials))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
    }
}
