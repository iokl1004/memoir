package com.iokl1004.memoir.auth;

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
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AccountSecurityTest {

    private static final String PASSWORD = "password123!";

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    /** 진짜 Cloudflare 대신, GOOD_TOKEN만 통과시켜요. */
    @MockitoSpyBean
    Captcha captcha;

    private static final String GOOD_TOKEN = "good-token";

    /** 테스트마다 다른 접속 주소를 써서, 주소별 제한이 다른 테스트에 번지지 않게 해요. */
    String ip;

    @BeforeEach
    void setUp() {
        doAnswer(call -> GOOD_TOKEN.equals(call.getArgument(0))).when(captcha).verify(any(), any());
        ip = "10.0." + (int) (Math.random() * 250) + "." + (int) (Math.random() * 250);
    }

    // ---------------------------------------------------------------- 로그인 시도 제한 (캡차)

    @Test
    void 네_번까지는_그냥_틀리고_다섯_번째부터_캡차를_요구한다() throws Exception {
        String email = signup();
        for (int i = 1; i <= 2; i++) {
            login(email, "wrong-pass", null).andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.detail").value("이메일 또는 패스워드가 올바르지 않아요."));
        }
        login(email, "wrong-pass", null)
                .andExpect(jsonPath("$.detail").value("이메일 또는 패스워드가 올바르지 않아요. 앞으로 2번 더 틀리면 로봇이 아닌지 확인해야 해요."));
        login(email, "wrong-pass", null)
                .andExpect(jsonPath("$.detail").value("이메일 또는 패스워드가 올바르지 않아요. 앞으로 1번 더 틀리면 로봇이 아닌지 확인해야 해요."));
        login(email, "wrong-pass", null).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.captchaRequired").value(true))
                .andExpect(jsonPath("$.captchaSiteKey").isNotEmpty());

        // 이제는 맞는 패스워드도 캡차 없이는 확인하지 않아요. 기다릴 필요는 없어요.
        login(email, PASSWORD, null).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("로봇이 아닌지 확인해 주세요."))
                .andExpect(jsonPath("$.captchaRequired").value(true));
        login(email, PASSWORD, "bad-token").andExpect(status().isBadRequest());
        login(email, PASSWORD, GOOD_TOKEN).andExpect(status().isOk());
    }

    @Test
    void 로그인에_성공하면_횟수가_처음부터다() throws Exception {
        String email = signup();
        for (int i = 0; i < 5; i++) login(email, "wrong-pass", null);
        login(email, PASSWORD, GOOD_TOKEN).andExpect(status().isOk());

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM login_failures WHERE throttle_key = ?", Integer.class,
                LoginThrottle.accountKey(email))).isZero();
        login(email, "wrong-pass", null).andExpect(jsonPath("$.captchaRequired").doesNotExist());
    }

    @Test
    void 가입하지_않은_이메일도_똑같이_캡차를_요구한다() throws Exception {
        String email = "nobody-" + UUID.randomUUID() + "@example.com";
        for (int i = 0; i < 4; i++) login(email, "wrong-pass", null).andExpect(jsonPath("$.captchaRequired").doesNotExist());
        login(email, "wrong-pass", null).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.captchaRequired").value(true));
    }

    @Test
    void 한_주소에서_여러_계정을_돌아가며_대입하면_그_주소는_캡차를_풀어야_한다() throws Exception {
        for (int i = 1; i < LoginThrottle.IP_CAPTCHA_AFTER; i++) {
            login("spray-" + UUID.randomUUID() + "@example.com", "wrong-pass", null)
                    .andExpect(jsonPath("$.captchaRequired").doesNotExist());
        }
        login("spray-" + UUID.randomUUID() + "@example.com", "wrong-pass", null).andExpect(jsonPath("$.captchaRequired").value(true));
        login("spray-" + UUID.randomUUID() + "@example.com", "wrong-pass", null).andExpect(status().isBadRequest());
    }

    // ---------------------------------------------------------------- 패스워드 변경

    @Test
    void 지금_패스워드를_확인하고_새_패스워드로_바꾼다() throws Exception {
        String email = signup();
        MockHttpSession session = session(email);

        json(put("/api/auth/password"), session, "{\"currentPassword\": \"nope-nope\", \"newPassword\": \"another-pass1!\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("현재 패스워드가 맞지 않아요."));
        json(put("/api/auth/password"), session, "{\"currentPassword\": \"%s\", \"newPassword\": \"%s\"}".formatted(PASSWORD, PASSWORD))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("현재와 다른 패스워드를 적어 주세요."));
        json(put("/api/auth/password"), session, "{\"currentPassword\": \"%s\", \"newPassword\": \"another-pass1!\"}".formatted(PASSWORD))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/auth/me").session(session)).andExpect(status().isOk());
        login(email, PASSWORD).andExpect(status().isUnauthorized());
        login(email, "another-pass1!").andExpect(status().isOk());
    }

    @Test
    void 로그인하지_않으면_패스워드를_바꿀_수_없다() throws Exception {
        mvc.perform(put("/api/auth/password").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\": \"a\", \"newPassword\": \"another-pass1!\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------- 계정 지우기

    @Test
    void 계정을_지우면_섹션_메모_그림까지_모두_지워지고_다시_로그인할_수_없다() throws Exception {
        String email = signup();
        MockHttpSession session = session(email);
        long userId = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
        long parent = idOf(json(post("/api/sections"), session, "{\"name\": \"A회사\"}"));
        long child = idOf(json(post("/api/sections"), session, "{\"name\": \"회의\", \"parentId\": %d}".formatted(parent)));
        json(post("/api/sections"), session, "{\"name\": \"깊은 곳\", \"parentId\": %d}".formatted(child));
        json(post("/api/memos"), session, "{\"sectionId\": %d, \"title\": \"메모\", \"content\": \"내용\"}".formatted(child))
                .andExpect(status().isCreated());

        json(delete("/api/auth/account"), session, "{\"password\": \"wrong-pass\"}").andExpect(status().isBadRequest());
        json(delete("/api/auth/account"), session, "{\"password\": \"%s\"}".formatted(PASSWORD)).andExpect(status().isNoContent());

        for (String table : new String[]{"users WHERE id", "sections WHERE user_id", "memos WHERE user_id", "memo_images WHERE user_id"}) {
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " = ?", Integer.class, userId)).as(table).isZero();
        }
        mvc.perform(get("/api/auth/me").session(session)).andExpect(status().isUnauthorized());
        login(email, PASSWORD).andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------- 도우미

    private String signup() throws Exception {
        String email = "account-" + UUID.randomUUID() + "@example.com";
        mvc.perform(post("/api/auth/signup").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\": \"%s\", \"password\": \"%s\"}".formatted(email, PASSWORD)))
                .andExpect(status().isCreated());
        return email;
    }

    private MockHttpSession session(String email) throws Exception {
        return (MockHttpSession) login(email, PASSWORD).andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private ResultActions login(String email, String password) throws Exception {
        return login(email, password, null);
    }

    private ResultActions login(String email, String password, String captchaToken) throws Exception {
        String token = captchaToken == null ? "null" : "\"" + captchaToken + "\"";
        return mvc.perform(post("/api/auth/login").with(csrf()).with(r -> { r.setRemoteAddr(ip); return r; })
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\": \"%s\", \"password\": \"%s\", \"captchaToken\": %s}".formatted(email, password, token)));
    }

    private ResultActions json(MockHttpServletRequestBuilder request, MockHttpSession session, String body) throws Exception {
        return mvc.perform(request.session(session).with(csrf()).with(r -> { r.setRemoteAddr(ip); return r; })
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private static long idOf(ResultActions result) throws Exception {
        Number id = com.jayway.jsonpath.JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.id");
        return id.longValue();
    }
}
