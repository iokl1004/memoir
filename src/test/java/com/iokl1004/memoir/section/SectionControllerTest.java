package com.iokl1004.memoir.section;

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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
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
class SectionControllerTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    MockHttpSession session;

    @BeforeEach
    void 가입하고_로그인한다() throws Exception {
        session = signupAndLogin();
    }

    @Test
    void 가입_직후에는_미분류_섹션_하나만_있다() throws Exception {
        mvc.perform(get("/api/sections").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].name").value("미분류"))
                .andExpect(jsonPath("$[0].isDefault").value(true));
    }

    @Test
    void 섹션을_만들면_미분류_다음에_만든_순서로_보인다() throws Exception {
        create("업무").andExpect(status().isCreated()).andExpect(jsonPath("$.isDefault").value(false));
        create("  공부  ").andExpect(status().isCreated()).andExpect(jsonPath("$.name").value("공부"));

        mvc.perform(get("/api/sections").session(session))
                .andExpect(jsonPath("$[*].name").value(org.hamcrest.Matchers.contains("미분류", "업무", "공부")));
    }

    @Test
    void 같은_이름은_409() throws Exception {
        create("업무").andExpect(status().isCreated());

        create("업무").andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("같은 위치에 같은 이름의 섹션이 이미 있어요."));
        create("미분류").andExpect(status().isConflict());
    }

    @Test
    void 다른_사람과는_같은_이름을_써도_된다() throws Exception {
        create("업무").andExpect(status().isCreated());
        session = signupAndLogin();

        create("업무").andExpect(status().isCreated());
    }

    @Test
    void 이름이_비었거나_30자를_넘으면_400() throws Exception {
        create("   ").andExpect(status().isBadRequest());
        create("가".repeat(31)).andExpect(status().isBadRequest());
        create("가".repeat(30)).andExpect(status().isCreated());
    }

    @Test
    void 이름을_바꿀_수_있고_다른_섹션_이름과_겹치면_409() throws Exception {
        long id = idOf(create("업무"));
        create("공부").andExpect(status().isCreated());

        rename(id, "회사").andExpect(status().isOk()).andExpect(jsonPath("$.name").value("회사"));
        rename(id, "회사").andExpect(status().isOk());
        rename(id, "공부").andExpect(status().isConflict());
    }

    @Test
    void 미분류는_이름을_바꾸거나_삭제할_수_없다() throws Exception {
        long defaultId = defaultSectionId();

        rename(defaultId, "기본").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("미분류 섹션은 이름을 바꾸거나 삭제할 수 없어요."));
        mvc.perform(delete("/api/sections/{id}", defaultId).session(session).with(csrf()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void 섹션을_지우면_안의_메모는_미분류로_옮겨진다() throws Exception {
        long id = idOf(create("업무"));
        long userId = jdbc.queryForObject("SELECT user_id FROM sections WHERE id = ?", Long.class, id);
        insertMemo(userId, id, "회의록");
        insertMemo(userId, id, "배포 회고");

        mvc.perform(delete("/api/sections/{id}", id).session(session).with(csrf()))
                .andExpect(status().isNoContent());

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sections WHERE id = ?", Integer.class, id)).isZero();
        assertThat(jdbc.queryForList("SELECT section_id FROM memos WHERE user_id = ?", Long.class, userId))
                .hasSize(2)
                .containsOnly(defaultSectionId());
    }

    @Test
    void 다른_사람의_섹션은_없는_것처럼_404() throws Exception {
        long othersId = idOf(create("업무"));
        session = signupAndLogin();

        rename(othersId, "가로채기").andExpect(status().isNotFound());
        mvc.perform(delete("/api/sections/{id}", othersId).session(session).with(csrf()))
                .andExpect(status().isNotFound());
        rename(999_999L, "없음").andExpect(status().isNotFound());
    }

    @Test
    void 로그인하지_않으면_401() throws Exception {
        mvc.perform(get("/api/sections")).andExpect(status().isUnauthorized());
    }

    private ResultActions create(String name) throws Exception {
        return mvc.perform(post("/api/sections").session(session).with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(nameJson(name)));
    }

    private ResultActions rename(long id, String name) throws Exception {
        return mvc.perform(patch("/api/sections/{id}", id).session(session).with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(nameJson(name)));
    }

    private long defaultSectionId() throws Exception {
        String body = mvc.perform(get("/api/sections").session(session))
                .andReturn().getResponse().getContentAsString();
        return Long.parseLong(body.replaceAll("^\\[\\{\"id\":(\\d+).*", "$1"));
    }

    private static long idOf(ResultActions result) throws Exception {
        String body = result.andReturn().getResponse().getContentAsString();
        return Long.parseLong(body.replaceAll("^\\{\"id\":(\\d+).*", "$1"));
    }

    private void insertMemo(long userId, long sectionId, String title) {
        jdbc.update("INSERT INTO memos (user_id, section_id, title, content, created_at, updated_at) "
                + "VALUES (?, ?, ?, '', NOW(6), NOW(6))", userId, sectionId, title);
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

    private static String nameJson(String name) {
        return "{\"name\": \"" + name + "\"}";
    }
}
