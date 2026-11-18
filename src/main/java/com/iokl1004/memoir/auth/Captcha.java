package com.iokl1004.memoir.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.time.Duration;
import java.util.Map;

/**
 * Cloudflare Turnstile 캡차. 화면에서 받은 토큰을 Cloudflare에 보내 진짜 사람이 푼 건지 확인해요.
 * 키를 설정하지 않으면 Cloudflare가 주는 테스트 키(항상 통과)를 써요. 실제 키는 README의 "캡차"를 보세요.
 */
@Component
public class Captcha {

    private static final Logger log = LoggerFactory.getLogger(Captcha.class);
    private static final String VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    private final String siteKey;
    private final String secretKey;
    private final RestClient http;

    public Captcha(@Value("${memoir.captcha.site-key}") String siteKey,
                   @Value("${memoir.captcha.secret-key}") String secretKey) {
        this.siteKey = siteKey;
        this.secretKey = secretKey;
        if (siteKey.startsWith("1x000000")) {
            log.warn("캡차가 Cloudflare 테스트 키라서 누구나 통과해요. 배포했다면 CAPTCHA_SITE_KEY, CAPTCHA_SECRET_KEY를 넣어 주세요.");
        }
        SimpleClientHttpRequestFactory timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(3));
        timeouts.setReadTimeout(Duration.ofSeconds(5));
        this.http = RestClient.builder().requestFactory(timeouts).build();
    }

    /** 토큰이 맞는지 Cloudflare에 물어봐요. 토큰은 한 번만 쓸 수 있어요. Cloudflare에 닿지 못하면 통과시키지 않아요. */
    public boolean verify(String token, String ip) {
        if (token == null || token.isBlank() || token.length() > 2048) {
            return false;
        }
        LinkedMultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("secret", secretKey);
        form.add("response", token);
        form.add("remoteip", ip);
        try {
            Map<?, ?> result = http.post().uri(VERIFY_URL).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form).retrieve().body(Map.class);
            return result != null && Boolean.TRUE.equals(result.get("success"));
        } catch (RestClientException e) {
            log.warn("캡차를 확인하지 못했어요: {}", e.getMessage());
            return false;
        }
    }

    /** 캡차가 필요하다는 응답. 화면이 캡차를 그릴 수 있게 사이트 키를 함께 보내요. */
    public ErrorResponseException required(HttpStatus status, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setProperty("captchaRequired", true);
        problem.setProperty("captchaSiteKey", siteKey);
        return new ErrorResponseException(status, problem, null);
    }
}
