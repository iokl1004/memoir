package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.TestcontainersConfiguration;
import com.iokl1004.memoir.support.Api;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Random;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 한 사람의 그림 용량 제한. 시험하기 쉽게 1MB로 낮춰서 확인해요. (기본은 200MB) */
@SpringBootTest(properties = "memoir.images.quota-mb=1")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ImageQuotaTest {

    @Autowired
    MockMvc mvc;

    @Test
    void 저장_공간을_넘는_그림은_받지_않고_다른_사람과는_따로_센다() throws Exception {
        byte[] noise = noisyPng(); // 약 0.6MB, 압축되지 않는 그림
        Api api = Api.signupAndLogin(mvc);

        upload(api, noise).andExpect(status().isCreated());
        // 서버가 그림을 줄여 저장해서 한 장의 크기는 정확히 알 수 없어요. 1MB를 넘을 때까지 올려 봐요.
        int status = 201;
        for (int i = 0; i < 10 && status == 201; i++) {
            status = upload(api, noise).andReturn().getResponse().getStatus();
        }
        assertThat(status).isEqualTo(413);
        upload(api, noise).andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.detail").value("그림 저장 공간(1MB)을 다 썼어요. 그림이 든 메모를 지우면 공간이 생겨요."));

        upload(Api.signupAndLogin(mvc), noise).andExpect(status().isCreated());
    }

    private org.springframework.test.web.servlet.ResultActions upload(Api api, byte[] bytes) throws Exception {
        return api.perform(multipart("/api/images").file(new MockMultipartFile("file", "a.png", "image/png", bytes)));
    }

    private static byte[] noisyPng() throws Exception {
        BufferedImage image = new BufferedImage(450, 450, BufferedImage.TYPE_INT_RGB);
        Random random = new Random(1);
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                image.setRGB(x, y, random.nextInt(0x1000000));
            }
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }
}
