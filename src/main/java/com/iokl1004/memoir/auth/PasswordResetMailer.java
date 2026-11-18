package com.iokl1004.memoir.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

/**
 * 패스워드 재설정 메일을 보내요. 메일 서버(spring.mail.host)를 설정하지 않은 개발 환경에서는
 * 메일 대신 로그에 링크를 남겨요. 설정 방법은 README의 "패스워드 찾기 메일"을 보세요.
 */
@Component
public class PasswordResetMailer {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetMailer.class);

    private final ObjectProvider<JavaMailSender> sender;
    private final String appUrl;
    private final String from;

    public PasswordResetMailer(ObjectProvider<JavaMailSender> sender,
                               @Value("${memoir.app-url}") String appUrl,
                               @Value("${memoir.mail.from:}") String from) {
        this.sender = sender;
        this.appUrl = appUrl.replaceAll("/+$", "");
        this.from = from;
    }

    @Async
    public void send(String to, String token) {
        String link = appUrl + "/?reset=" + token;
        JavaMailSender mail = sender.getIfAvailable();
        if (mail == null) {
            // 개발용: 메일 서버가 없을 때만 남겨요. 운영에서는 메일 설정을 해야 로그에 링크가 남지 않아요.
            log.warn("메일 서버 설정이 없어서 패스워드 재설정 링크를 로그로 남겨요: {}", link);
            return;
        }
        SimpleMailMessage message = new SimpleMailMessage();
        if (!from.isBlank()) {
            message.setFrom(from);
        }
        message.setTo(to);
        message.setSubject("[memoir] 패스워드 재설정 링크");
        message.setText("""
                memoir 패스워드를 다시 정하려면 아래 링크를 눌러 주세요.
                링크는 30분 동안 한 번만 쓸 수 있어요.

                %s

                패스워드 찾기를 요청하지 않았다면 이 메일은 지워도 돼요. 패스워드는 바뀌지 않아요.
                """.formatted(link));
        try {
            mail.send(message);
        } catch (MailException e) {
            log.error("패스워드 재설정 메일을 보내지 못했어요: {}", e.getMessage());
        }
    }
}
