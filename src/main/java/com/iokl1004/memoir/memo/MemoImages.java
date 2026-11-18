package com.iokl1004.memoir.memo;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collection;

/** 메모 그림을 줄여 저장하고, 어느 메모에도 없는 그림을 정리해요. */
@Component
public class MemoImages {

    /** 긴 변이 이보다 크면 줄여요. 메모 화면에서는 이 정도면 충분해요. */
    static final int MAX_SIDE = 2000;
    /** 메모에서 빠진 그림을 이만큼 남겨 둬요. 실수로 지웠다가 되돌려 저장할 시간이에요. */
    static final Duration KEEP_DETACHED = Duration.ofDays(1);

    private final JdbcClient jdbc;

    public MemoImages(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    record Encoded(byte[] data, String contentType) {
    }

    /**
     * 큰 그림은 줄이고, PNG·JPEG 중 더 작은 쪽으로 저장해요. 캡처 화면은 대개 PNG가, 사진은 JPEG가 작아요.
     * GIF(움직이는 그림)와 WebP는 그대로 둬요.
     */
    static Encoded shrink(byte[] data, String type) {
        if (!type.equals("image/png") && !type.equals("image/jpeg")) {
            return new Encoded(data, type);
        }
        // shortcut: 휴대폰 사진은 EXIF의 회전 정보로 똑바로 보이는데, 다시 저장하면 그 정보가 빠져서 누워 버려요.
        // EXIF가 있는 JPEG는 그대로 둬요. 큰 사진이 많아지면 회전을 읽어 적용하는 라이브러리를 들여요.
        if (type.equals("image/jpeg") && hasExif(data)) {
            return new Encoded(data, type);
        }
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(data));
            if (image == null) {
                return new Encoded(data, type);
            }
            boolean resized = Math.max(image.getWidth(), image.getHeight()) > MAX_SIDE;
            BufferedImage out = resized ? resize(image) : image;

            Encoded best = new Encoded(png(out), "image/png");
            if (!out.getColorModel().hasAlpha()) {
                byte[] jpeg = jpeg(out);
                if (jpeg != null && jpeg.length < best.data().length) {
                    best = new Encoded(jpeg, "image/jpeg");
                }
            }
            // 줄일 필요가 없는데 다시 저장한 게 더 크면 원래 파일을 써요.
            return !resized && data.length <= best.data().length ? new Encoded(data, type) : best;
        } catch (IOException | RuntimeException e) {
            return new Encoded(data, type);
        }
    }

    /** 본문에 있는 그림은 이 메모에 묶고, 본문에서 빠진 그림은 떼어 둬요(하루 뒤 정리). */
    void syncWithMemo(Long userId, Long memoId, Collection<Long> imageIds) {
        String keep = imageIds.isEmpty() ? "" : " AND id NOT IN (:ids)";
        var detach = jdbc.sql("UPDATE memo_images SET memo_id = NULL, detached_at = :now WHERE memo_id = :memoId" + keep)
                .param("now", LocalDateTime.now())
                .param("memoId", memoId);
        (imageIds.isEmpty() ? detach : detach.param("ids", imageIds)).update();
        if (imageIds.isEmpty()) {
            return;
        }
        jdbc.sql("UPDATE memo_images SET memo_id = :memoId, detached_at = NULL "
                        + "WHERE user_id = :userId AND memo_id IS NULL AND id IN (:ids)")
                .param("memoId", memoId)
                .param("userId", userId)
                .param("ids", imageIds)
                .update();
    }

    /** 어느 메모에도 없는 채로 하루가 지난 그림을 지워요. 매일 새벽 4시 30분에 돌아요. */
    @Scheduled(cron = "0 30 4 * * *")
    public int deleteOrphans() {
        return jdbc.sql("DELETE FROM memo_images WHERE memo_id IS NULL AND detached_at < ?")
                .param(LocalDateTime.now().minus(KEEP_DETACHED))
                .update();
    }

    private static BufferedImage resize(BufferedImage image) {
        double scale = (double) MAX_SIDE / Math.max(image.getWidth(), image.getHeight());
        int w = Math.max(1, (int) Math.round(image.getWidth() * scale));
        int h = Math.max(1, (int) Math.round(image.getHeight() * scale));
        BufferedImage out = new BufferedImage(w, h,
                image.getColorModel().hasAlpha() ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(image, 0, 0, w, h, null);
        g.dispose();
        return out;
    }

    private static byte[] png(BufferedImage image) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    /** JPEG(품질 0.85). 색 형식이 맞지 않아 쓸 수 없으면 null */
    private static byte[] jpeg(BufferedImage image) throws IOException {
        BufferedImage rgb = image;
        if (image.getType() != BufferedImage.TYPE_INT_RGB && image.getType() != BufferedImage.TYPE_3BYTE_BGR) {
            rgb = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_RGB);
            Graphics2D g = rgb.createGraphics();
            g.drawImage(image, 0, 0, null);
            g.dispose();
        }
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ImageOutputStream stream = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(stream);
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(0.85f);
            writer.write(null, new IIOImage(rgb, null, null), param);
        } finally {
            writer.dispose();
        }
        return out.size() > 0 ? out.toByteArray() : null;
    }

    /** JPEG 앞부분(64KB)에 EXIF 블록이 있는지 */
    private static boolean hasExif(byte[] data) {
        byte[] head = Arrays.copyOf(data, Math.min(data.length, 65_536));
        return new String(head, StandardCharsets.ISO_8859_1).contains("Exif\0\0");
    }
}
