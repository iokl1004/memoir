package com.iokl1004.memoir.auth;

import com.iokl1004.memoir.TestcontainersConfiguration;
import com.iokl1004.memoir.section.Section;
import com.iokl1004.memoir.section.SectionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AuthControllerTest {

    private static final String PASSWORD = "password123!";

    @Autowired
    MockMvc mvc;

    @Autowired
    UserRepository users;

    @Autowired
    SectionRepository sections;

    @Test
    void 가입하면_회원과_미분류_섹션이_만들어진다() throws Exception {
        String email = newEmail();

        mvc.perform(signup(email, PASSWORD))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value(email));

        User user = users.findByEmail(email).orElseThrow();
        assertThat(user.getPassword()).isNotEqualTo(PASSWORD).startsWith("$2");
        assertThat(sections.findByUserId(user.getId()))
                .singleElement()
                .satisfies(s -> {
                    assertThat(s.getName()).isEqualTo(Section.DEFAULT_NAME);
                    assertThat(s.isDefaultSection()).isTrue();
                });
    }

    @Test
    void 이메일은_대소문자와_공백을_정리해서_저장한다() throws Exception {
        String email = newEmail();

        mvc.perform(signup("  " + email.toUpperCase() + " ", PASSWORD))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value(email));
    }

    @Test
    void 이미_가입된_이메일이면_409() throws Exception {
        String email = newEmail();
        mvc.perform(signup(email, PASSWORD)).andExpect(status().isCreated());

        mvc.perform(signup(email, PASSWORD))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("이미 가입된 이메일이에요."));
    }

    @Test
    void 패스워드가_규칙에_맞지_않으면_400() throws Exception {
        mvc.perform(signup(newEmail(), "short")).andExpect(status().isBadRequest());
        mvc.perform(signup(newEmail(), "has space 123")).andExpect(status().isBadRequest());
        mvc.perform(signup(newEmail(), "한글패스워드입니다")).andExpect(status().isBadRequest());
        mvc.perform(signup("not-an-email", PASSWORD)).andExpect(status().isBadRequest());
    }

    @Test
    void 로그인하면_세션으로_내_정보를_조회하고_로그아웃하면_401() throws Exception {
        String email = newEmail();
        mvc.perform(signup(email, PASSWORD)).andExpect(status().isCreated());

        MockHttpSession session = (MockHttpSession) mvc.perform(login(email, PASSWORD))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email))
                .andReturn().getRequest().getSession(false);

        mvc.perform(get("/api/auth/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email));

        mvc.perform(post("/api/auth/logout").session(session).with(csrf()))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/auth/me").session(session))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void 패스워드가_틀리거나_없는_이메일이면_같은_401() throws Exception {
        String email = newEmail();
        mvc.perform(signup(email, PASSWORD)).andExpect(status().isCreated());

        mvc.perform(login(email, "wrong-password"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail").value("이메일 또는 패스워드가 올바르지 않아요."));
        mvc.perform(login(newEmail(), PASSWORD))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail").value("이메일 또는 패스워드가 올바르지 않아요."));
    }

    @Test
    void 로그인하지_않으면_API는_401() throws Exception {
        mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void CSRF_토큰_없이_POST하면_403() throws Exception {
        mvc.perform(post("/api/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(newEmail(), PASSWORD)))
                .andExpect(status().isForbidden());
    }

    private static org.springframework.test.web.servlet.RequestBuilder signup(String email, String password) {
        return post("/api/auth/signup").with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(email, password));
    }

    private static org.springframework.test.web.servlet.RequestBuilder login(String email, String password) {
        return post("/api/auth/login").with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(email, password));
    }

    private static String json(String email, String password) {
        return """
                {"email": "%s", "password": "%s"}
                """.formatted(email, password);
    }

    private static String newEmail() {
        return "user-" + UUID.randomUUID() + "@example.com";
    }
}
