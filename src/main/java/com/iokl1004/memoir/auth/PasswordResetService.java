package com.iokl1004.memoir.auth;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;

/**
 * 비밀번호 찾기.
 * 1. 이메일을 받으면 1회용 링크를 메일로 보내요. 가입하지 않은 이메일이어도 똑같이 응답해서 가입 여부가 새지 않아요.
 * 2. 링크의 토큰과 새 비밀번호를 받으면 비밀번호를 바꾸고, 다른 기기의 로그인도 모두 끊어요.
 */
@Service
public class PasswordResetService {

    static final Duration TOKEN_TTL = Duration.ofMinutes(30);
    /** 같은 계정에 메일을 연달아 보내지 않게 해요. (메일 폭탄, 발송 한도 보호) */
    static final Duration RESEND_GAP = Duration.ofMinutes(1);

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final PasswordResetMailer mailer;
    private final JdbcClient jdbc;
    private final SecureRandom random = new SecureRandom();

    public PasswordResetService(UserRepository users, PasswordEncoder passwordEncoder, PasswordResetMailer mailer,
                                JdbcClient jdbc) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.mailer = mailer;
        this.jdbc = jdbc;
    }

    @Transactional
    public void request(String email) {
        users.findByEmail(email).ifPresent(user -> {
            LocalDateTime now = LocalDateTime.now();
            boolean recent = jdbc.sql("SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = ? AND created_at > ?")
                    .params(user.getId(), now.minus(RESEND_GAP))
                    .query(Long.class).single() > 0;
            if (recent) {
                return;
            }
            byte[] bytes = new byte[32];
            random.nextBytes(bytes);
            String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
            jdbc.sql("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)")
                    .params(user.getId(), hash(token), now.plus(TOKEN_TTL), now)
                    .update();
            // 메일은 따로 보내요(@Async). 가입한 이메일만 응답이 느려지면 그 차이로 가입 여부가 새어 나가서요.
            mailer.send(user.getEmail(), token);
        });
    }

    @Transactional
    public void confirm(String token, String rawPassword) {
        Long userId = jdbc.sql("SELECT user_id FROM password_reset_tokens "
                        + "WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? FOR UPDATE")
                .params(hash(token), LocalDateTime.now())
                .query(Long.class).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "링크가 만료됐거나 이미 썼어요. 비밀번호 찾기를 다시 해 주세요."));
        User user = users.findById(userId).orElseThrow();
        user.changePassword(passwordEncoder.encode(rawPassword));

        // 이 계정의 다른 링크도 함께 못 쓰게 하고, 로그인돼 있던 세션은 모두 끊어요.
        jdbc.sql("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL")
                .params(LocalDateTime.now(), userId).update();
        jdbc.sql("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME = ?").params(user.getEmail()).update();
    }

    private static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
