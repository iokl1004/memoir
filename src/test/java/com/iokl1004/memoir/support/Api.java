package com.iokl1004.memoir.support;

import com.jayway.jsonpath.JsonPath;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.List;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 새 테스트에서 쓰는 API 호출 도우미. 가입한 사용자 한 명의 세션으로 요청해요. */
public final class Api {

    private final MockMvc mvc;
    public final MockHttpSession session;

    private Api(MockMvc mvc, MockHttpSession session) {
        this.mvc = mvc;
        this.session = session;
    }

    public static Api signupAndLogin(MockMvc mvc) throws Exception {
        String credentials = """
                {"email": "user-%s@example.com", "password": "password123!"}
                """.formatted(UUID.randomUUID());
        mvc.perform(post("/api/auth/signup").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(credentials))
                .andExpect(status().isCreated());
        MockHttpSession session = (MockHttpSession) mvc.perform(post("/api/auth/login").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(credentials))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
        return new Api(mvc, session);
    }

    public ResultActions perform(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.session(session).with(csrf()));
    }

    public ResultActions json(MockHttpServletRequestBuilder request, String body) throws Exception {
        return perform(request.contentType(MediaType.APPLICATION_JSON).content(body));
    }

    public long createSection(String name, Long parentId) throws Exception {
        return id(json(post("/api/sections"), "{\"name\": \"%s\", \"parentId\": %s}".formatted(name, parentId))
                .andExpect(status().isCreated()));
    }

    public long createMemo(Long sectionId, String title) throws Exception {
        return id(json(post("/api/memos"), "{\"sectionId\": %s, \"title\": \"%s\", \"content\": \"\"}"
                .formatted(sectionId, title)).andExpect(status().isCreated()));
    }

    public ResultActions move(long memoId, Long afterId, Long beforeId) throws Exception {
        return json(put("/api/memos/{id}/position", memoId),
                "{\"afterId\": %s, \"beforeId\": %s}".formatted(afterId, beforeId));
    }

    public List<String> titles(String query) throws Exception {
        return JsonPath.read(perform(get("/api/memos?" + query)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(), "$.items[*].title");
    }

    public String body(MockHttpServletRequestBuilder request) throws Exception {
        return perform(request).andReturn().getResponse().getContentAsString();
    }

    public static long id(ResultActions result) throws Exception {
        Number id = JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.id");
        return id.longValue();
    }
}
