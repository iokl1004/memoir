package com.iokl1004.memoir.auth;

import com.iokl1004.memoir.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** 로그인 세션이 서버 메모리가 아니라 DB에 저장돼서, 서버를 다시 켜도 로그인이 유지되는지 확인해요. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.autoconfigure.exclude=") // build.gradle에서 테스트용으로 끈 Spring Session을 여기서는 켜요.
@Import(TestcontainersConfiguration.class)
class SessionPersistenceTest {

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void 로그인하면_세션이_DB에_저장되고_다른_클라이언트도_그_쿠키로_로그인_상태다() throws Exception {
        CookieManager cookies = new CookieManager();
        HttpClient browser = HttpClient.newBuilder().cookieHandler(cookies).build();
        browser.send(get("/api/auth/me"), HttpResponse.BodyHandlers.discarding());
        String xsrf = cookie(cookies, "XSRF-TOKEN");

        String email = "session-%s@example.com".formatted(UUID.randomUUID());
        String body = "{\"email\": \"%s\", \"password\": \"password123!\"}".formatted(email);
        assertThat(browser.send(post("/api/auth/signup", body, xsrf), HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(201);
        assertThat(browser.send(post("/api/auth/login", body, xsrf), HttpResponse.BodyHandlers.discarding()).statusCode()).isEqualTo(200);

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM SPRING_SESSION WHERE PRINCIPAL_NAME = ?", Integer.class, email))
                .isEqualTo(1);

        // 메모리에 아무것도 없는 새 클라이언트가 세션 쿠키만 들고 와도 로그인 상태예요. (서버를 다시 켠 것과 같은 상황)
        String session = cookie(cookies, "SESSION");
        HttpResponse<String> me = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create(url("/api/auth/me"))).header("Cookie", "SESSION=" + session).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(me.statusCode()).isEqualTo(200);
        assertThat(me.body()).contains(email);
    }

    private static String cookie(CookieManager cookies, String name) {
        return cookies.getCookieStore().getCookies().stream()
                .filter(c -> c.getName().equals(name)).map(HttpCookie::getValue).findFirst().orElseThrow();
    }

    private String url(String path) {
        return "http://localhost:" + port + path;
    }

    private HttpRequest get(String path) {
        return HttpRequest.newBuilder(URI.create(url(path))).GET().build();
    }

    private HttpRequest post(String path, String json, String xsrf) {
        return HttpRequest.newBuilder(URI.create(url(path)))
                .header("Content-Type", "application/json")
                .header("X-XSRF-TOKEN", xsrf)
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
    }
}
