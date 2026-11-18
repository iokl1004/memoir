package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.auth.LoginUser;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Arrays;

/** 메모 본문에 붙여넣은 그림을 올리고 보여줘요. 그림은 올린 사람만 볼 수 있어요. */
@RestController
@RequestMapping("/api/images")
public class MemoImageController {

    static final int MAX_BYTES = 5 * 1024 * 1024;

    private final JdbcClient jdbc;
    /** 한 사람이 저장할 수 있는 그림 용량. 무료 DB가 금방 차지 않게 해요. */
    private final long quotaBytes;

    public MemoImageController(JdbcClient jdbc, @Value("${memoir.images.quota-mb:200}") long quotaMb) {
        this.jdbc = jdbc;
        this.quotaBytes = quotaMb * 1024 * 1024;
    }

    record UploadedImage(Long id, String url) {
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public UploadedImage upload(@AuthenticationPrincipal LoginUser user, @RequestParam("file") MultipartFile file)
            throws IOException {
        if (file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "그림 파일이 비어 있어요.");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "그림은 5MB까지 올릴 수 있어요.");
        }
        byte[] data = file.getBytes();
        // 브라우저가 알려준 형식은 믿지 않고 파일 앞부분으로 확인해요. (SVG처럼 스크립트가 들어갈 수 있는 형식은 받지 않아요)
        String type = sniff(data);
        if (type == null) {
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "PNG, JPEG, GIF, WebP 그림만 올릴 수 있어요.");
        }
        MemoImages.Encoded stored = MemoImages.shrink(data, type);
        long used = jdbc.sql("SELECT COALESCE(SUM(byte_size), 0) FROM memo_images WHERE user_id = ?")
                .param(user.id()).query(Long.class).single();
        if (used + stored.data().length > quotaBytes) {
            throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "그림 저장 공간(%dMB)을 다 썼어요. 그림이 든 메모를 지우면 공간이 생겨요."
                    .formatted(quotaBytes / 1024 / 1024));
        }
        LocalDateTime now = LocalDateTime.now();
        KeyHolder key = new GeneratedKeyHolder();
        // 아직 어느 메모에도 없어서 detached_at을 채워 둬요. 메모를 저장하면 비워지고, 끝내 저장하지 않으면 하루 뒤 지워져요.
        jdbc.sql("INSERT INTO memo_images (user_id, content_type, byte_size, data, created_at, detached_at) VALUES (?, ?, ?, ?, ?, ?)")
                .params(user.id(), stored.contentType(), stored.data().length, stored.data(), now, now)
                .update(key);
        long id = key.getKeyAs(Number.class).longValue();
        return new UploadedImage(id, "/api/images/" + id);
    }

    @GetMapping("/{id}")
    public ResponseEntity<byte[]> get(@AuthenticationPrincipal LoginUser user, @PathVariable Long id) {
        record Image(String contentType, byte[] data) {
        }
        Image image = jdbc.sql("SELECT content_type, data FROM memo_images WHERE id = ? AND user_id = ?")
                .params(id, user.id())
                .query(Image.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "그림을 찾을 수 없어요."));
        // 그림은 바뀌지 않으니 브라우저에 오래 둬요. 로그인한 사람의 그림이라 공유 캐시에는 두지 않아요.
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(image.contentType()))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePrivate().immutable())
                .body(image.data());
    }

    static String sniff(byte[] d) {
        if (starts(d, 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A)) return "image/png";
        if (starts(d, 0xFF, 0xD8, 0xFF)) return "image/jpeg";
        if (starts(d, 'G', 'I', 'F', '8')) return "image/gif";
        if (starts(d, 'R', 'I', 'F', 'F') && d.length > 12
                && Arrays.equals(Arrays.copyOfRange(d, 8, 12), "WEBP".getBytes())) return "image/webp";
        return null;
    }

    private static boolean starts(byte[] d, int... magic) {
        if (d.length < magic.length) return false;
        for (int i = 0; i < magic.length; i++) {
            if ((d[i] & 0xFF) != magic[i]) return false;
        }
        return true;
    }
}
