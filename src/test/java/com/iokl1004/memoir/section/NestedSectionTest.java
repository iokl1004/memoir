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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
    void 섹션을_고르면_그_섹션에_바로_쓴_메모만_보인다() throws Exception {
        api.createMemo(companyA, "회사 공지");
        api.createMemo(projectA, "A 회의록");
        api.createMemo(deep, "회고 초안");
        api.createMemo(projectB, "B 일정");
        api.createMemo(null, "장보기");

        assertThat(api.titles("sectionId=" + companyA)).containsExactly("회사 공지");
        assertThat(api.titles("sectionId=" + projectA)).containsExactly("A 회의록");
        assertThat(api.titles("sectionId=" + deep)).containsExactly("회고 초안");
        assertThat(api.titles("sectionId=" + projectA + "&q=회고")).isEmpty();
        assertThat(api.titles("")).hasSize(5);
    }

    // ---------- 섹션 옮기기 ----------

    @Test
    void 섹션을_다른_섹션_안이나_최상위로_옮기면_하위_섹션과_메모가_따라간다() throws Exception {
        long companyB = api.createSection("B회사", null);
        long memo = api.createMemo(deep, "회고 초안");

        // A회사 > A프로젝트 > 2026 회고  →  B회사 > A프로젝트 > 2026 회고
        api.json(put("/api/sections/{id}/parent", projectA), "{\"parentId\": %d}".formatted(companyB))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.parentId").value(companyB));
        assertThat(parentOf(projectA)).isEqualTo((int) companyB);
        assertThat(parentOf(deep)).isEqualTo((int) projectA);
        api.perform(get("/api/memos/{id}", memo)).andExpect(jsonPath("$.sectionId").value(deep));

        // 최상위로
        api.json(put("/api/sections/{id}/parent", deep), "{\"parentId\": null}").andExpect(status().isOk());
        assertThat(parentOf(deep)).isNull();
    }

    @Test
    void 자기_자신이나_하위_섹션_안으로는_옮길_수_없다() throws Exception {
        api.json(put("/api/sections/{id}/parent", companyA), "{\"parentId\": %d}".formatted(companyA))
                .andExpect(status().isBadRequest());
        api.json(put("/api/sections/{id}/parent", companyA), "{\"parentId\": %d}".formatted(deep))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("자기 자신이나 하위 섹션 안으로는 옮길 수 없어요."));
        assertThat(parentOf(companyA)).isNull();
    }

    @Test
    void 미분류는_옮길_수_없고_미분류_안으로도_옮길_수_없다() throws Exception {
        long defaultId = ((Number) JsonPath.read(api.body(get("/api/sections")), "$[0].id")).longValue();
        api.json(put("/api/sections/{id}/parent", defaultId), "{\"parentId\": %d}".formatted(companyA))
                .andExpect(status().isBadRequest());
        api.json(put("/api/sections/{id}/parent", projectB), "{\"parentId\": %d}".formatted(defaultId))
                .andExpect(status().isBadRequest());
    }

    @Test
    void 옮길_곳에_같은_이름이_있으면_409() throws Exception {
        api.createSection("2026 회고", projectB);
        api.json(put("/api/sections/{id}/parent", deep), "{\"parentId\": %d}".formatted(projectB))
                .andExpect(status().isConflict());
        assertThat(parentOf(deep)).isEqualTo((int) projectA);
    }

    @Test
    void 다른_사람의_섹션은_옮길_수도_그_안으로_옮길_수도_없다() throws Exception {
        Api other = Api.signupAndLogin(mvc);
        long mine = other.createSection("내 섹션", null);
        other.json(put("/api/sections/{id}/parent", companyA), "{\"parentId\": null}").andExpect(status().isNotFound());
        other.json(put("/api/sections/{id}/parent", mine), "{\"parentId\": %d}".formatted(companyA))
                .andExpect(status().isNotFound());
    }

    private Integer parentOf(long sectionId) throws Exception {
        List<Integer> parents = JsonPath.read(api.body(get("/api/sections")), "$[?(@.id == %d)].parentId".formatted(sectionId));
        return parents.getFirst();
    }

    // ---------- 섹션 순서 ----------

    @Test
    void 새_섹션은_같은_상위_안에서_맨_아래에_온다() throws Exception {
        api.createSection("C프로젝트", companyA);
        assertThat(childrenOf(companyA)).containsExactly("A프로젝트", "B프로젝트", "C프로젝트");
    }

    @Test
    void 같은_상위_안에서_순서를_바꿀_수_있다() throws Exception {
        api.createSection("C프로젝트", companyA);
        moveTo(projectB, companyA, projectA).andExpect(status().isOk());       // B를 A 위로
        assertThat(childrenOf(companyA)).containsExactly("B프로젝트", "A프로젝트", "C프로젝트");

        moveTo(projectB, companyA, null).andExpect(status().isOk());           // B를 맨 아래로
        assertThat(childrenOf(companyA)).containsExactly("A프로젝트", "C프로젝트", "B프로젝트");
    }

    @Test
    void 다른_상위로_옮기면서_자리를_정할_수_있다() throws Exception {
        long companyB = api.createSection("B회사", null);
        api.createSection("X", companyB);
        long y = api.createSection("Y", companyB);

        moveTo(projectA, companyB, y).andExpect(status().isOk());
        assertThat(childrenOf(companyB)).containsExactly("X", "A프로젝트", "Y");
        assertThat(childrenOf(companyA)).containsExactly("B프로젝트");
        assertThat(parentOf(deep)).isEqualTo((int) projectA);
    }

    @Test
    void 기준_섹션이_옮길_곳의_형제가_아니면_400() throws Exception {
        moveTo(projectB, companyA, deep).andExpect(status().isBadRequest());
        assertThat(childrenOf(companyA)).containsExactly("A프로젝트", "B프로젝트");
    }

    private org.springframework.test.web.servlet.ResultActions moveTo(long id, Long parentId, Long beforeId) throws Exception {
        return api.json(put("/api/sections/{id}/parent", id), "{\"parentId\": %s, \"beforeId\": %s}".formatted(parentId, beforeId));
    }

    private List<String> childrenOf(long parentId) throws Exception {
        return JsonPath.read(api.body(get("/api/sections")), "$[?(@.parentId == %d)].name".formatted(parentId));
    }

    @Test
    void 상위_섹션을_지우면_하위_섹션과_그_안의_메모가_모두_지워진다() throws Exception {
        long m1 = api.createMemo(companyA, "회사 공지");
        long m2 = api.createMemo(deep, "회고 초안");
        long keep = api.createSection("다른 회사", null);
        long kept = api.createMemo(keep, "남는 메모");

        api.perform(delete("/api/sections/{id}", companyA)).andExpect(status().isNoContent());

        String sections = api.body(get("/api/sections"));
        assertThat(JsonPath.<List<String>>read(sections, "$[*].name")).containsExactly("미분류", "다른 회사");
        for (long memoId : new long[]{m1, m2}) {
            api.perform(get("/api/memos/{id}", memoId)).andExpect(status().isNotFound());
        }
        api.perform(get("/api/memos/{id}", kept)).andExpect(status().isOk());
    }
}
