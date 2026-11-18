package com.iokl1004.memoir.auth;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;

/** 로그인한 사람의 계정 관리: 패스워드 변경, 계정 지우기. 둘 다 현재 패스워드를 한 번 더 확인해요. */
@Service
public class AccountService {

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final LoginThrottle throttle;
    private final JdbcClient jdbc;

    public AccountService(UserRepository users, PasswordEncoder passwordEncoder, LoginThrottle throttle, JdbcClient jdbc) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.throttle = throttle;
        this.jdbc = jdbc;
    }

    /** 패스워드를 바꾸고, 지금 쓰는 세션만 남기고 다른 기기의 로그인은 끊어요. */
    @Transactional
    public void changePassword(Long userId, String currentPassword, String newPassword, String captchaToken, String ip,
                               String keepSessionId) {
        User user = verify(userId, currentPassword, captchaToken, ip);
        if (passwordEncoder.matches(newPassword, user.getPassword())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "현재와 다른 패스워드를 적어 주세요.");
        }
        user.changePassword(passwordEncoder.encode(newPassword));
        jdbc.sql("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL")
                .params(LocalDateTime.now(), userId).update();
        jdbc.sql("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME = ? AND SESSION_ID <> ?")
                .params(user.getEmail(), keepSessionId == null ? "" : keepSessionId).update();
    }

    /** 계정과 메모·섹션·그림을 모두 지워요. 되살릴 수 없어요. */
    @Transactional
    public void deleteAccount(Long userId, String password, String captchaToken, String ip) {
        User user = verify(userId, password, captchaToken, ip);
        jdbc.sql("DELETE FROM memo_images WHERE user_id = ?").param(userId).update();
        jdbc.sql("DELETE FROM memos WHERE user_id = ?").param(userId).update();
        // 섹션은 부모를 가리키는 FK가 있어서, 하위 섹션이 없는 섹션부터 한 단계씩 지워요.
        while (jdbc.sql("DELETE s FROM sections s LEFT JOIN sections c ON c.parent_id = s.id "
                + "WHERE s.user_id = ? AND c.id IS NULL").param(userId).update() > 0) {
            // 지울 섹션이 없을 때까지
        }
        jdbc.sql("DELETE FROM login_failures WHERE throttle_key = ?").param(LoginThrottle.accountKey(user.getEmail())).update();
        jdbc.sql("DELETE FROM SPRING_SESSION WHERE PRINCIPAL_NAME = ?").param(user.getEmail()).update();
        users.delete(user); // 패스워드 찾기 링크는 DB가 함께 지워요(ON DELETE CASCADE)
    }

    /** 현재 패스워드가 맞는지 확인해요. 틀리면 로그인과 똑같이 시도 횟수에 넣어서, 이 화면으로 대입해 볼 수 없게 해요. */
    private User verify(Long userId, String rawPassword, String captchaToken, String ip) {
        User user = users.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요해요."));
        throttle.checkCaptcha(user.getEmail(), ip, captchaToken);
        if (!passwordEncoder.matches(rawPassword, user.getPassword())) {
            throw throttle.wrongPassword(user.getEmail(), ip, HttpStatus.BAD_REQUEST, "현재 패스워드가 맞지 않아요.");
        }
        return user;
    }
}
