package com.iokl1004.memoir.auth;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 패스워드를 대입해 보는 공격을 막아요. 잠그는 대신, 많이 틀리면 캡차(사람인지 확인)를 풀어야 다시 시도할 수 있어요.
 * - 계정: 최근 15분 동안 5번 틀리면 그다음부터 캡차
 * - 접속 주소(IP): 여러 계정을 돌아가며 대입하는 걸 막아요. 20번 틀리면 그다음부터 캡차
 * - 15분 동안 더 틀리지 않으면 처음부터 다시 세고, 로그인에 성공하면 그 계정의 기록을 지워요.
 * 가입하지 않은 이메일도 똑같이 세서, 캡차가 뜨는지로 가입 여부가 드러나지 않아요.
 */
@Component
public class LoginThrottle {

    static final int ACCOUNT_CAPTCHA_AFTER = 5;
    static final int IP_CAPTCHA_AFTER = 20;
    static final Duration WINDOW = Duration.ofMinutes(15);

    private final JdbcClient jdbc;
    private final Captcha captcha;
    /** 틀린 기록은 요청이 실패(롤백)로 끝나도 남아야 해서 따로 커밋해요. */
    private final TransactionTemplate separate;

    public LoginThrottle(JdbcClient jdbc, Captcha captcha, PlatformTransactionManager transactions) {
        this.jdbc = jdbc;
        this.captcha = captcha;
        this.separate = new TransactionTemplate(transactions);
        this.separate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** 패스워드를 확인하기 전에 불러요. 캡차가 필요한데 토큰이 없거나 틀리면 400(캡차 필요)을 던져요. */
    public void checkCaptcha(String email, String ip, String captchaToken) {
        if (captchaRequired(email, ip) && !captcha.verify(captchaToken, ip)) {
            throw captcha.required(HttpStatus.BAD_REQUEST, "로봇이 아닌지 확인해 주세요.");
        }
    }

    /**
     * 패스워드가 틀렸을 때 던질 응답을 만들어요. 틀린 횟수를 올리고,
     * 캡차가 곧 필요하면 미리 알려주고, 이제 필요하면 화면이 캡차를 그릴 수 있게 알려줘요.
     */
    public RuntimeException wrongPassword(String email, String ip, HttpStatus status, String message) {
        int left = recordFailure(email, ip);
        if (left == 0 || captchaRequired(email, ip)) {
            return captcha.required(status, message + " 로봇이 아닌지 확인한 뒤 다시 시도해 주세요.");
        }
        String warning = left <= 2 ? " 앞으로 " + left + "번 더 틀리면 로봇이 아닌지 확인해야 해요." : "";
        return new ResponseStatusException(status, message + warning);
    }

    static String accountKey(String email) {
        return "email:" + email;
    }

    static String ipKey(String ip) {
        return "ip:" + ip;
    }

    /** 이 계정이나 주소로 다시 시도하려면 캡차를 풀어야 하는지 */
    public boolean captchaRequired(String email, String ip) {
        record Row(String throttleKey, int failures) {
        }
        List<Row> rows = jdbc.sql("SELECT throttle_key, failures FROM login_failures "
                        + "WHERE throttle_key IN (:keys) AND first_failed_at > :since")
                .param("keys", List.of(accountKey(email), ipKey(ip)))
                .param("since", LocalDateTime.now().minus(WINDOW))
                .query(Row.class).list();
        return rows.stream().anyMatch(r -> r.failures() >= (r.throttleKey().startsWith("ip:") ? IP_CAPTCHA_AFTER : ACCOUNT_CAPTCHA_AFTER));
    }

    /** 틀린 횟수를 하나 올리고, 캡차가 필요해지기 전까지 이 계정에 남은 기회를 돌려줘요. (0이면 이제 캡차가 필요해요) */
    public int recordFailure(String email, String ip) {
        Integer failures = separate.execute(tx -> {
            record(ipKey(ip));
            return record(accountKey(email));
        });
        return Math.max(0, ACCOUNT_CAPTCHA_AFTER - failures);
    }

    /** 로그인에 성공하면 그 계정의 기록을 지워요. (IP 기록은 그대로 둬요) */
    public void recordSuccess(String email) {
        jdbc.sql("DELETE FROM login_failures WHERE throttle_key = ?").param(accountKey(email)).update();
    }

    /** 하루 넘게 지난 기록을 매시간 지워요. */
    @Scheduled(cron = "0 0 * * * *")
    public void deleteOld() {
        jdbc.sql("DELETE FROM login_failures WHERE first_failed_at < ?").param(LocalDateTime.now().minusDays(1)).update();
    }

    /** 틀린 횟수를 하나 올리고, 올린 뒤의 횟수를 돌려줘요. 15분이 지났으면 처음부터 세요. */
    private int record(String key) {
        LocalDateTime now = LocalDateTime.now();
        jdbc.sql("INSERT IGNORE INTO login_failures (throttle_key, failures, first_failed_at) VALUES (?, 0, ?)")
                .params(key, now).update();
        record Row(int failures, LocalDateTime firstFailedAt) {
        }
        Row row = jdbc.sql("SELECT failures, first_failed_at FROM login_failures WHERE throttle_key = ? FOR UPDATE")
                .param(key).query(Row.class).single();
        boolean fresh = row.firstFailedAt().isBefore(now.minus(WINDOW));
        int failures = (fresh ? 0 : row.failures()) + 1;
        jdbc.sql("UPDATE login_failures SET failures = ?, first_failed_at = ? WHERE throttle_key = ?")
                .params(failures, fresh ? now : row.firstFailedAt(), key)
                .update();
        return failures;
    }
}
