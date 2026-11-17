package com.iokl1004.memoir.section;

import com.iokl1004.memoir.TestcontainersConfiguration;
import com.iokl1004.memoir.support.Api;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class NestedSectionTest {

    @Autowired
    MockMvc mvc;

    Api api;
    long companyA;
    long projectA;
    long projectB;
    long deep;

    /** A회사 > A프로젝트 > 2026 회고, A회사 > B프로젝트 */
    @BeforeEach
    void 회사와_프로젝트_섹션을_만든다() throws Exception {
        api = Api.signupAndLogin(mvc);
        companyA = api.createSection("A회사", null);
        projectA = api.createSection("A프로젝트", companyA);
        projectB = api.createSection("B프로젝트", companyA);
        deep = api.createSection("2026 회고", projectA);
    }

    @Test
    void 목록에_상위_섹션_id가_함께_나온다() throws Exception {
        String body = api.body(get("/api/sections"));
        assertThat(JsonPath.<List<Integer>>read(body, "$[?(@.id == %d)].parentId".formatted(projectA)))
                .containsExactly((int) companyA);
        assertThat(JsonPath.<List<Object>>read(body, "$[?(@.id == %d)].parentId".formatted(companyA)))
                .containsExactly((Object) null);
    }

    @Test
    void 같은_부모_아래에서만_이름이_겹치면_안_된다() throws Exception {
        long companyB = api.createSection("B회사", null);
        api.createSection("A프로젝트", companyB); // 다른 회사 아래면 같은 이름도 돼요

        api.json(post("/api/sections"), "{\"name\": \"B프로젝트\", \"parentId\": %d}".formatted(companyA))
                .andExpect(status().isConflict());
        api.json(post("/api/sections"), "{\"name\": \"A회사\"}").andExpect(status().isConflict());
    }

    @Test
    void 미분류_안에는_섹션을_만들_수_없다() throws Exception {
        long defaultId = ((Number) JsonPath.read(api.body(get("/api/sections")), "$[0].id")).longValue();
        api.json(post("/api/sections"), "{\"name\": \"하위\", \"parentId\": %d}".formatted(defaultId))
                .andExpect(status().isBadRequest());
    }

    @Test
    void 다른_사람의_섹션_아래에는_만들_수_없다() throws Exception {
        Api other = Api.signupAndLogin(mvc);
        other.json(post("/api/sections"), "{\"name\": \"가로채기\", \"parentId\": %d}".formatted(companyA))
                .andExpect(status().isNotFound());
    }

    @Test
    void 상위_섹션을_고르면_하위_섹션의_메모까지_보인다() throws Exception {
        api.createMemo(companyA, "회사 공지");
        api.createMemo(projectA, "A 회의록");
        api.createMemo(deep, "회고 초안");
        api.createMemo(projectB, "B 일정");
        api.createMemo(null, "장보기");

        assertThat(api.titles("sectionId=" + companyA)).containsExactlyInAnyOrder("회사 공지", "A 회의록", "회고 초안", "B 일정");
        assertThat(api.titles("sectionId=" + projectA)).containsExactlyInAnyOrder("A 회의록", "회고 초안");
        assertThat(api.titles("sectionId=" + deep)).containsExactly("회고 초안");
        assertThat(api.titles("sectionId=" + projectA + "&q=회고")).containsExactly("회고 초안");
    }

    @Test
    void 상위_섹션을_지우면_하위_섹션도_지워지고_메모는_모두_미분류로_간다() throws Exception {
        long m1 = api.createMemo(companyA, "회사 공지");
        long m2 = api.createMemo(deep, "회고 초안");
        long keep = api.createSection("다른 회사", null);

        api.perform(delete("/api/sections/{id}", companyA)).andExpect(status().isNoContent());

        String sections = api.body(get("/api/sections"));
        assertThat(JsonPath.<List<String>>read(sections, "$[*].name")).containsExactly("미분류", "다른 회사");
        long defaultId = ((Number) JsonPath.read(sections, "$[0].id")).longValue();
        for (long memoId : new long[]{m1, m2}) {
            api.perform(get("/api/memos/{id}", memoId)).andExpect(jsonPath("$.sectionId").value(defaultId));
        }
        assertThat(keep).isPositive();
    }
}
