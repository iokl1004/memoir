package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.TestcontainersConfiguration;
import com.iokl1004.memoir.support.Api;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class MemoBulkAndCleanupTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    MemoImages images;

    Api api;

    @BeforeEach
    void setUp() throws Exception {
        api = Api.signupAndLogin(mvc);
    }

    @Test
    void 이름_정렬은_숫자를_크기_순서로_비교한다() throws Exception {
        for (String title : new String[]{"업무 일지 22", "업무 일지 9", "업무 일지 10", "Apple"}) {
            api.createMemo(null, title);
        }
        assertThat(api.titles("sort=TITLE_ASC")).containsExactly("Apple", "업무 일지 9", "업무 일지 10", "업무 일지 22");
        assertThat(api.titles("sort=TITLE_DESC")).containsExactly("업무 일지 22", "업무 일지 10", "업무 일지 9", "Apple");
    }

    @Test
    void 고른_메모를_한_번에_옮기고_지운다() throws Exception {
        long work = api.createSection("업무", null);
        long a = api.createMemo(null, "A");
        long b = api.createMemo(null, "B");
        long c = api.createMemo(null, "C");

        api.json(post("/api/memos/bulk-move"), "{\"ids\": [%d, %d], \"sectionId\": %d}".formatted(a, b, work))
                .andExpect(status().isNoContent());
        assertThat(api.titles("sectionId=" + work + "&sort=TITLE_ASC")).containsExactly("A", "B");

        api.json(post("/api/memos/bulk-delete"), "{\"ids\": [%d, %d]}".formatted(a, c)).andExpect(status().isNoContent());
        assertThat(api.titles("sort=TITLE_ASC")).containsExactly("B");
    }

    @Test
    void 남의_메모가_하나라도_섞이면_아무것도_바꾸지_않고_404() throws Exception {
        long mine = api.createMemo(null, "내 메모");
        long others = Api.signupAndLogin(mvc).createMemo(null, "남의 메모");

        api.json(post("/api/memos/bulk-delete"), "{\"ids\": [%d, %d]}".formatted(mine, others))
                .andExpect(status().isNotFound());
        assertThat(api.titles("")).containsExactly("내 메모");
        api.json(post("/api/memos/bulk-delete"), "{\"ids\": []}").andExpect(status().isBadRequest());
    }

    @Test
    void 큰_그림은_긴_변_2000px로_줄여_저장한다() throws Exception {
        BufferedImage big = new BufferedImage(3000, 1200, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(big, "png", png);

        long id = upload(png.toByteArray());
        byte[] stored = api.perform(get("/api/images/{id}", id)).andReturn().getResponse().getContentAsByteArray();
        BufferedImage read = ImageIO.read(new ByteArrayInputStream(stored));
        assertThat(read.getWidth()).isEqualTo(2000);
        assertThat(read.getHeight()).isEqualTo(800);
    }

    @Test
    void 본문에서_빠진_그림과_저장하지_않은_그림은_하루_뒤_정리된다() throws Exception {
        long kept = upload(tinyPng());
        long removed = upload(tinyPng());
        long neverSaved = upload(tinyPng());
        long memoId = Api.id(api.json(post("/api/memos"),
                "{\"contentHtml\": \"<img src=\\\"/api/images/%d\\\"><img src=\\\"/api/images/%d\\\">\"}".formatted(kept, removed)));

        // 본문에서 그림 하나를 빼고 저장해요.
        api.json(patch("/api/memos/{id}", memoId), "{\"contentHtml\": \"<img src=\\\"/api/images/%d\\\">\"}".formatted(kept))
                .andExpect(jsonPath("$.contentHtml").value("<img src=\"/api/images/%d\">".formatted(kept)));
        assertThat(jdbc.queryForObject("SELECT memo_id FROM memo_images WHERE id = ?", Long.class, removed)).isNull();

        // 하루가 지나기 전에는 지우지 않아요.
        images.deleteOrphans();
        api.perform(get("/api/images/{id}", removed)).andExpect(status().isOk());

        jdbc.update("UPDATE memo_images SET detached_at = NOW(6) - INTERVAL 2 DAY WHERE id IN (?, ?)", removed, neverSaved);
        images.deleteOrphans();
        api.perform(get("/api/images/{id}", removed)).andExpect(status().isNotFound());
        api.perform(get("/api/images/{id}", neverSaved)).andExpect(status().isNotFound());
        api.perform(get("/api/images/{id}", kept)).andExpect(status().isOk());
    }

    private long upload(byte[] bytes) throws Exception {
        return Api.id(api.perform(multipart("/api/images").file(new MockMultipartFile("file", "a.png", "image/png", bytes)))
                .andExpect(status().isCreated()));
    }

    private static byte[] tinyPng() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }
}
