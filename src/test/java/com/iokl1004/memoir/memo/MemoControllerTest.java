package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.TestcontainersConfiguration;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class MemoControllerTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    MockHttpSession session;
    long defaultSectionId;

    @BeforeEach
    void 가입하고_로그인한다() throws Exception {
        session = signupAndLogin();
        defaultSectionId = idOf(mvc.perform(get("/api/sections").session(session)), "$[0].id");
    }

    // ---------- 작성, 조회, 수정, 삭제 ----------

    @Test
    void 섹션을_안_고르면_미분류에_저장하고_빈_제목은_제목_없음() throws Exception {
        createMemo(null, "   ", "본문")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.sectionId").value(defaultSectionId))
                .andExpect(jsonPath("$.title").value("제목 없음"))
                .andExpect(jsonPath("$.content").value("본문"));
    }

    @Test
    void 메모를_조회하고_보낸_항목만_수정한다() throws Exception {
        long sectionId = createSection("업무");
        long memoId = idOf(createMemo(null, "회의록", "안건 정리"), "$.id");

        mvc.perform(get("/api/memos/{id}", memoId).session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("회의록"));

        updateMemo(memoId, "{\"sectionId\": " + sectionId + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sectionId").value(sectionId))
                .andExpect(jsonPath("$.title").value("회의록"))
                .andExpect(jsonPath("$.content").value("안건 정리"));

        updateMemo(memoId, "{\"title\": \"주간 회의록\", \"content\": \"결정 사항\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sectionId").value(sectionId))
                .andExpect(jsonPath("$.title").value("주간 회의록"))
                .andExpect(jsonPath("$.content").value("결정 사항"));
    }

    @Test
    void 삭제하면_다시_조회할_수_없다() throws Exception {
        long memoId = idOf(createMemo(null, "지울 메모", ""), "$.id");

        mvc.perform(delete("/api/memos/{id}", memoId).session(session).with(csrf()))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/memos/{id}", memoId).session(session))
                .andExpect(status().isNotFound());
    }

    @Test
    void 제목_100자_본문_2만자를_넘으면_400() throws Exception {
        createMemo(null, "가".repeat(101), "").andExpect(status().isBadRequest());
        createMemo(null, "제목", "가".repeat(20_001)).andExpect(status().isBadRequest());
        // 한글 2만 자 = 6만 바이트. 길이 제한 안이면 그대로 저장돼야 해요.
        createMemo(null, "가".repeat(100), "가".repeat(20_000)).andExpect(status().isCreated());
    }

    @Test
    void 다른_사람의_메모와_섹션은_없는_것처럼_404() throws Exception {
        long othersMemo = idOf(createMemo(null, "남의 메모", ""), "$.id");
        long othersSection = createSection("남의 섹션");
        session = signupAndLogin();

        mvc.perform(get("/api/memos/{id}", othersMemo).session(session)).andExpect(status().isNotFound());
        updateMemo(othersMemo, "{\"title\": \"가로채기\"}").andExpect(status().isNotFound());
        mvc.perform(delete("/api/memos/{id}", othersMemo).session(session).with(csrf()))
                .andExpect(status().isNotFound());
        createMemo(othersSection, "남의 섹션에 쓰기", "").andExpect(status().isNotFound());
    }

    // ---------- 목록과 검색 ----------

    @Test
    void 목록은_최신순으로_20개씩_나온다() throws Exception {
        for (int i = 1; i <= 21; i++) {
            createMemo(null, "메모 " + i, "").andExpect(status().isCreated());
        }

        search("").andExpect(jsonPath("$.items", hasSize(20)))
                .andExpect(jsonPath("$.items[0].title").value("메모 21"))
                .andExpect(jsonPath("$.total").value(21))
                .andExpect(jsonPath("$.totalCapped").value(false))
                .andExpect(jsonPath("$.hasNext").value(true));
        search("page=1").andExpect(jsonPath("$.items[*].title").value(contains("메모 1")));
    }

    @Test
    void 섹션으로_거르고_섹션_목록에_메모_개수가_나온다() throws Exception {
        long work = createSection("업무");
        createMemo(work, "회의록", "").andExpect(status().isCreated());
        createMemo(work, "보고서", "").andExpect(status().isCreated());
        createMemo(null, "장보기", "").andExpect(status().isCreated());

        search("sectionId=" + work).andExpect(jsonPath("$.items[*].title").value(containsInAnyOrder("회의록", "보고서")));
        mvc.perform(get("/api/sections").session(session))
                .andExpect(jsonPath("$[0].memoCount").value(1))
                .andExpect(jsonPath("$[1].memoCount").value(2));
    }

    @Test
    void 키워드는_제목이나_본문에서_찾고_여러_단어는_모두_포함해야_한다() throws Exception {
        createMemo(null, "배포 회고", "서버 오류가 있었다").andExpect(status().isCreated());
        createMemo(null, "배포 체크리스트", "문제 없음").andExpect(status().isCreated());
        createMemo(null, "장보기", "Deploy 문서 읽기").andExpect(status().isCreated());

        search("q=배포").andExpect(jsonPath("$.items[*].title").value(containsInAnyOrder("배포 회고", "배포 체크리스트")));
        search("q=배포 오류").andExpect(jsonPath("$.items[*].title").value(contains("배포 회고")));
        search("q=deploy").andExpect(jsonPath("$.items[*].title").value(contains("장보기")));
    }

    @Test
    void 검색어의_퍼센트와_밑줄은_글자_그대로_찾는다() throws Exception {
        createMemo(null, "할인 50% 쿠폰", "").andExpect(status().isCreated());
        createMemo(null, "file_name 규칙", "").andExpect(status().isCreated());
        createMemo(null, "평범한 메모", "").andExpect(status().isCreated());

        mvc.perform(get("/api/memos").param("q", "%").session(session))
                .andExpect(jsonPath("$.items[*].title").value(contains("할인 50% 쿠폰")));
        mvc.perform(get("/api/memos").param("q", "_").session(session))
                .andExpect(jsonPath("$.items[*].title").value(contains("file_name 규칙")));
    }

    @Test
    void 작성일_기간으로_거르고_양_끝_날짜를_포함한다() throws Exception {
        setCreatedAt(idOf(createMemo(null, "2월 메모", ""), "$.id"), "2026-02-28 23:59:59");
        setCreatedAt(idOf(createMemo(null, "3월 첫날", ""), "$.id"), "2026-03-01 00:00:00");
        setCreatedAt(idOf(createMemo(null, "3월 말일", ""), "$.id"), "2026-03-31 23:59:59");
        setCreatedAt(idOf(createMemo(null, "4월 메모", ""), "$.id"), "2026-04-01 00:00:00");

        search("from=2026-03-01&to=2026-03-31")
                .andExpect(jsonPath("$.items[*].title").value(contains("3월 말일", "3월 첫날")));
        search("from=2026-04-01").andExpect(jsonPath("$.items[*].title").value(contains("4월 메모")));
        search("from=2026-04-01&to=2026-03-01").andExpect(status().isBadRequest());
        search("from=2026-13-01").andExpect(status().isBadRequest());
    }

    @Test
    void 목록에는_본문_앞부분만_한_줄로_나온다() throws Exception {
        createMemo(null, "긴 메모", "첫 줄\n\n둘째 줄  " + "가".repeat(200)).andExpect(status().isCreated());

        search("").andExpect(jsonPath("$.items[0].preview").value(("첫 줄 둘째 줄 " + "가".repeat(200)).substring(0, 100)))
                .andExpect(jsonPath("$.items[0].content").doesNotExist());
    }

    @Test
    void 섹션을_지우면_메모가_미분류로_옮겨진다() throws Exception {
        long work = createSection("업무");
        long memoId = idOf(createMemo(work, "회의록", ""), "$.id");

        mvc.perform(delete("/api/sections/{id}", work).session(session).with(csrf()))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/memos/{id}", memoId).session(session))
                .andExpect(jsonPath("$.sectionId").value(defaultSectionId));
    }

    @Test
    void 로그인하지_않으면_401() throws Exception {
        mvc.perform(get("/api/memos")).andExpect(status().isUnauthorized());
    }

    // ---------- 도우미 ----------

    private ResultActions createMemo(Long sectionId, String title, String content) throws Exception {
        String body = """
                {"sectionId": %s, "title": "%s", "content": "%s"}
                """.formatted(sectionId, title, content.replace("\n", "\\n"));
        return mvc.perform(json(post("/api/memos"), body));
    }

    private ResultActions updateMemo(long id, String body) throws Exception {
        return mvc.perform(json(patch("/api/memos/{id}", id), body));
    }

    private ResultActions search(String query) throws Exception {
        return mvc.perform(get("/api/memos?" + query).session(session));
    }

    private long createSection(String name) throws Exception {
        return idOf(mvc.perform(json(post("/api/sections"), "{\"name\": \"" + name + "\"}"))
                .andExpect(status().isCreated()), "$.id");
    }

    private MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, String body) {
        return request.session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private void setCreatedAt(long memoId, String dateTime) {
        jdbc.update("UPDATE memos SET created_at = ? WHERE id = ?", dateTime, memoId);
    }

    private static long idOf(ResultActions result, String jsonPath) throws Exception {
        String body = result.andReturn().getResponse().getContentAsString();
        Number id = com.jayway.jsonpath.JsonPath.read(body, jsonPath);
        return id.longValue();
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
