package com.iokl1004.memoir.auth;

import com.iokl1004.memoir.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class PasswordResetTest {

    private static final String OLD = "old-password1!";
    private static final String NEW = "new-password2!";

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    /** 실제 메일 대신 보낸 토큰을 붙잡아요. */
    @MockitoBean
    PasswordResetMailer mailer;

    @Test
    void 메일의_링크로_새_패스워드를_정하면_새_패스워드로만_로그인된다() throws Exception {
        String email = signup();
        String token = requestToken(email);

        json("/api/auth/password-reset/confirm", "{\"token\": \"%s\", \"password\": \"%s\"}".formatted(token, NEW))
                .andExpect(status().isNoContent());

        login(email, NEW).andExpect(status().isOk());
        login(email, OLD).andExpect(status().isUnauthorized());
    }

    @Test
    void 링크는_한_번만_쓸_수_있다() throws Exception {
        String token = requestToken(signup());
        json("/api/auth/password-reset/confirm", "{\"token\": \"%s\", \"password\": \"%s\"}".formatted(token, NEW))
                .andExpect(status().isNoContent());

        json("/api/auth/password-reset/confirm", "{\"token\": \"%s\", \"password\": \"another-pass3!\"}".formatted(token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("링크가 만료됐거나 이미 썼어요. 패스워드 찾기를 다시 해 주세요."));
    }

    @Test
    void 만든_지_30분이_지난_링크는_쓸_수_없다() throws Exception {
        String email = signup();
        String token = requestToken(email);
        jdbc.update("UPDATE password_reset_tokens t JOIN users u ON u.id = t.user_id "
                + "SET t.expires_at = NOW(6) - INTERVAL 1 MINUTE WHERE u.email = ?", email);

        json("/api/auth/password-reset/confirm", "{\"token\": \"%s\", \"password\": \"%s\"}".formatted(token, NEW))
                .andExpect(status().isBadRequest());
        login(email, OLD).andExpect(status().isOk());
    }

    @Test
    void 가입하지_않은_이메일도_같은_204이고_메일은_보내지_않는다() throws Exception {
        json("/api/auth/password-reset", "{\"email\": \"nobody-%s@example.com\"}".formatted(UUID.randomUUID()))
                .andExpect(status().isNoContent());
        verify(mailer, never()).send(anyString(), anyString());
    }

    @Test
    void 일분_안에_다시_요청하면_메일을_한_번만_보낸다() throws Exception {
        String email = signup();
        clearInvocations(mailer);
        json("/api/auth/password-reset", "{\"email\": \"%s\"}".formatted(email)).andExpect(status().isNoContent());
        json("/api/auth/password-reset", "{\"email\": \"%s\"}".formatted(email)).andExpect(status().isNoContent());
        verify(mailer, times(1)).send(eq(email), anyString());
    }

    @Test
    void 새_패스워드도_가입할_때와_같은_규칙을_지켜야_한다() throws Exception {
        String token = requestToken(signup());
        json("/api/auth/password-reset/confirm", "{\"token\": \"%s\", \"password\": \"short\"}".formatted(token))
                .andExpect(status().isBadRequest());
    }

    private String signup() throws Exception {
        String email = "reset-" + UUID.randomUUID() + "@example.com";
        json("/api/auth/signup", "{\"email\": \"%s\", \"password\": \"%s\"}".formatted(email, OLD))
                .andExpect(status().isCreated());
        return email;
    }

    private String requestToken(String email) throws Exception {
        clearInvocations(mailer);
        json("/api/auth/password-reset", "{\"email\": \"%s\"}".formatted(email)).andExpect(status().isNoContent());
        ArgumentCaptor<String> token = ArgumentCaptor.forClass(String.class);
        verify(mailer).send(eq(email), token.capture());
        return token.getValue();
    }

    private ResultActions login(String email, String password) throws Exception {
        return json("/api/auth/login", "{\"email\": \"%s\", \"password\": \"%s\"}".formatted(email, password));
    }

    private ResultActions json(String path, String body) throws Exception {
        return mvc.perform(post(path).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(body));
    }
}
