package com.iokl1004.memoir.auth;

import com.iokl1004.memoir.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;

import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 처음 온 브라우저처럼 실제 HTTP로 확인해요. (MockMvc의 Security 테스트 설정은 CSRF 쿠키를 쓰지 않아서 여기서는 확인할 수 없어요)
 * 첫 응답에 XSRF-TOKEN 쿠키가 없으면, 처음 시도하는 가입·로그인 POST가 403으로 거부돼요.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
class CsrfFirstVisitTest {

    @LocalServerPort
    int port;

    @Test
    void 처음_온_브라우저도_첫_요청부터_가입하고_로그인할_수_있다() throws Exception {
        CookieManager cookies = new CookieManager();
        HttpClient client = HttpClient.newBuilder().cookieHandler(cookies).build();

        HttpResponse<String> me = client.send(get("/api/auth/me"), HttpResponse.BodyHandlers.ofString());
        assertThat(me.statusCode()).isEqualTo(401);
        String xsrf = cookies.getCookieStore().getCookies().stream()
                .filter(c -> c.getName().equals("XSRF-TOKEN")).map(HttpCookie::getValue).findFirst().orElse(null);
        assertThat(xsrf).as("첫 401 응답에 XSRF-TOKEN 쿠키가 있어야 해요").isNotBlank();

        String body = "{\"email\": \"first-%s@example.com\", \"password\": \"password123!\"}".formatted(UUID.randomUUID());
        assertThat(client.send(post("/api/auth/signup", body, xsrf), HttpResponse.BodyHandlers.ofString()).statusCode())
                .isEqualTo(201);
        assertThat(client.send(post("/api/auth/login", body, xsrf), HttpResponse.BodyHandlers.ofString()).statusCode())
                .isEqualTo(200);
    }

    private HttpRequest get(String path) {
        return HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build();
    }

    private HttpRequest post(String path, String json, String xsrf) {
        return HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json")
                .header("X-XSRF-TOKEN", xsrf)
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
    }
}
