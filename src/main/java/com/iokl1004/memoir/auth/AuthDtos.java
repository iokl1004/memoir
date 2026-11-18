package com.iokl1004.memoir.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.Locale;

final class AuthDtos {

    private AuthDtos() {
    }

    record SignupRequest(
            @NotBlank @Email @Size(max = 255) String email,
            // BCrypt는 72바이트까지만 쓰므로, 공백 없는 영문·숫자·특수문자 8~64자로 제한해요.
            @NotBlank @Pattern(regexp = "^[\\x21-\\x7E]{8,64}$",
                    message = "패스워드는 공백 없이 영문, 숫자, 특수문자로 8~64자여야 해요.") String password) {

        SignupRequest {
            email = normalize(email);
        }
    }

    /** captchaToken: 많이 틀린 뒤에만 필요해요(LoginThrottle). */
    record LoginRequest(@NotBlank String email, @NotBlank String password, String captchaToken) {

        LoginRequest {
            email = normalize(email);
        }
    }

    record PasswordResetRequest(@NotBlank @Email @Size(max = 255) String email) {

        PasswordResetRequest {
            email = normalize(email);
        }
    }

    record PasswordResetConfirm(
            @NotBlank @Size(max = 100) String token,
            @NotBlank @Pattern(regexp = "^[\\x21-\\x7E]{8,64}$",
                    message = "패스워드는 공백 없이 영문, 숫자, 특수문자로 8~64자여야 해요.") String password) {
    }

    record PasswordChangeRequest(
            @NotBlank @Size(max = 64) String currentPassword,
            @NotBlank @Pattern(regexp = "^[\\x21-\\x7E]{8,64}$",
                    message = "패스워드는 공백 없이 영문, 숫자, 특수문자로 8~64자여야 해요.") String newPassword, String captchaToken) {
    }

    record AccountDeleteRequest(@NotBlank @Size(max = 64) String password, String captchaToken) {
    }

    /** 검증 전에 이메일 앞뒤 공백을 지우고 소문자로 맞춰요. */
    private static String normalize(String email) {
        return email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }

    record MeResponse(Long id, String email) {
    }
}
