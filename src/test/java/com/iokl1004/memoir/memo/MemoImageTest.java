package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.TestcontainersConfiguration;
import com.iokl1004.memoir.support.Api;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class MemoImageTest {

    /** 가장 작은 PNG(1×1) */
    private static final byte[] PNG = java.util.Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    Api api;

    @BeforeEach
    void setUp() throws Exception {
        api = Api.signupAndLogin(mvc);
    }

    @Test
    void 그림을_올리면_올린_사람만_볼_수_있다() throws Exception {
        long id = upload(api, PNG);

        api.perform(get("/api/images/{id}", id))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "image/png"))
                .andExpect(content().bytes(PNG));

        Api other = Api.signupAndLogin(mvc);
        other.perform(get("/api/images/{id}", id)).andExpect(status().isNotFound());
    }

    @Test
    void 그림이_아닌_파일은_형식을_속여도_415() throws Exception {
        MockMultipartFile fake = new MockMultipartFile("file", "x.png", "image/png", "<svg onload=alert(1)>".getBytes());
        api.perform(multipart("/api/images").file(fake)).andExpect(status().isUnsupportedMediaType());
    }

    @Test
    void 본문_HTML은_정리하고_글자만_뽑아_검색에_쓴다() throws Exception {
        long imageId = upload(api, PNG);
        String html = "<h2>배포 회의</h2><p>오늘 <strong>롤백</strong> 결정</p><script>alert(1)</script>"
                + "<p><img src=\"/api/images/" + imageId + "\" width=\"240\" onerror=\"alert(1)\">"
                + "<img src=\"https://evil.example/x.png\"><img src=\"data:image/png;base64,AAAA\"></p>";

        String body = api.json(post("/api/memos"), "{\"title\": \"회의\", \"contentHtml\": %s}".formatted(str(html)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        String saved = JsonPath.read(body, "$.contentHtml");
        assertThat(saved).contains("<h2>배포 회의</h2>", "<strong>롤백</strong>", "<img src=\"/api/images/" + imageId + "\" width=\"240\">")
                .doesNotContain("script", "onerror", "evil.example", "data:");
        assertThat((String) JsonPath.read(body, "$.content")).isEqualTo("배포 회의\n오늘 롤백 결정");
        assertThat(api.titles("q=롤백")).containsExactly("회의");
        assertThat(api.titles("q=strong")).isEmpty();
    }

    @Test
    void 메모를_지우면_그_메모의_그림도_지워진다() throws Exception {
        long imageId = upload(api, PNG);
        long memoId = Api.id(api.json(post("/api/memos"), "{\"contentHtml\": %s}".formatted(str("<p><img src=\"/api/images/" + imageId + "\"></p>"))));
        assertThat(jdbc.queryForObject("SELECT memo_id FROM memo_images WHERE id = ?", Long.class, imageId)).isEqualTo(memoId);

        api.perform(delete("/api/memos/{id}", memoId)).andExpect(status().isNoContent());
        api.perform(get("/api/images/{id}", imageId)).andExpect(status().isNotFound());
    }

    @Test
    void 글자만_보내던_예전_방식도_그대로_된다() throws Exception {
        long memoId = Api.id(api.json(post("/api/memos"), "{\"title\": \"예전\", \"content\": \"한 줄\\n두 줄\"}"));
        api.perform(get("/api/memos/{id}", memoId))
                .andExpect(jsonPath("$.content").value("한 줄\n두 줄"))
                .andExpect(jsonPath("$.contentHtml").doesNotExist());

        api.json(patch("/api/memos/{id}", memoId), "{\"contentHtml\": \"<p>새 본문</p>\"}")
                .andExpect(jsonPath("$.content").value("새 본문"))
                .andExpect(jsonPath("$.contentHtml").value("<p>새 본문</p>"));
    }

    @Test
    void 본문_글자가_20000자를_넘으면_400() throws Exception {
        String html = "<p>" + "가".repeat(20_001) + "</p>";
        api.json(post("/api/memos"), "{\"contentHtml\": %s}".formatted(str(html)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("본문은 20,000자까지 쓸 수 있어요."));
    }

    /** JSON 문자열 값 */
    private static String str(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static long upload(Api api, byte[] bytes) throws Exception {
        return Api.id(api.perform(multipart("/api/images").file(new MockMultipartFile("file", "shot.png", "image/png", bytes)))
                .andExpect(status().isCreated()));
    }
}
