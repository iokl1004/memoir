package com.iokl1004.memoir.auth;

import com.iokl1004.memoir.auth.AuthDtos.AccountDeleteRequest;
import com.iokl1004.memoir.auth.AuthDtos.LoginRequest;
import com.iokl1004.memoir.auth.AuthDtos.MeResponse;
import com.iokl1004.memoir.auth.AuthDtos.PasswordChangeRequest;
import com.iokl1004.memoir.auth.AuthDtos.PasswordResetConfirm;
import com.iokl1004.memoir.auth.AuthDtos.PasswordResetRequest;
import com.iokl1004.memoir.auth.AuthDtos.SignupRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final PasswordResetService passwordResetService;
    private final AccountService accountService;
    private final LoginThrottle throttle;
    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository securityContextRepository;

    public AuthController(AuthService authService, PasswordResetService passwordResetService, AccountService accountService,
                          LoginThrottle throttle, AuthenticationManager authenticationManager,
                          SecurityContextRepository securityContextRepository) {
        this.authService = authService;
        this.passwordResetService = passwordResetService;
        this.accountService = accountService;
        this.throttle = throttle;
        this.authenticationManager = authenticationManager;
        this.securityContextRepository = securityContextRepository;
    }

    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public MeResponse signup(@Valid @RequestBody SignupRequest request) {
        User user = authService.signup(request.email(), request.password());
        return new MeResponse(user.getId(), user.getEmail());
    }

    @PostMapping("/login")
    public MeResponse login(@Valid @RequestBody LoginRequest request,
                            HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        // 많이 틀린 계정이나 주소면 캡차부터 확인해요. 가입하지 않은 이메일도 똑같이 세요.
        String ip = httpRequest.getRemoteAddr();
        throttle.checkCaptcha(request.email(), ip, request.captchaToken());
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(request.email(), request.password()));
        } catch (AuthenticationException e) {
            // 이메일이 없는지, 패스워드가 틀렸는지 구분하지 않아야 가입 여부가 새지 않아요.
            throw throttle.wrongPassword(request.email(), ip, HttpStatus.UNAUTHORIZED, "이메일 또는 패스워드가 올바르지 않아요.");
        }
        throttle.recordSuccess(request.email());

        // 로그인 전 세션 ID를 그대로 쓰면 세션 고정 공격을 당할 수 있어서 새 ID로 바꿔요.
        if (httpRequest.getSession(false) != null) {
            httpRequest.changeSessionId();
        }
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, httpRequest, httpResponse);

        LoginUser user = (LoginUser) authentication.getPrincipal();
        return new MeResponse(user.id(), user.email());
    }

    /** 패스워드 찾기 메일을 보내요. 가입 여부와 상관없이 늘 204예요. */
    @PostMapping("/password-reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void requestPasswordReset(@Valid @RequestBody PasswordResetRequest request) {
        passwordResetService.request(request.email());
    }

    /** 메일 링크의 토큰으로 새 패스워드를 정해요. */
    @PostMapping("/password-reset/confirm")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void confirmPasswordReset(@Valid @RequestBody PasswordResetConfirm request) {
        passwordResetService.confirm(request.token(), request.password());
    }

    /** 로그인한 상태에서 패스워드를 바꿔요. 지금 기기는 로그인을 유지하고, 다른 기기는 끊어요. */
    @PutMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(@AuthenticationPrincipal LoginUser user, @Valid @RequestBody PasswordChangeRequest request,
                               HttpServletRequest httpRequest) {
        var session = httpRequest.getSession(false);
        accountService.changePassword(user.id(), request.currentPassword(), request.newPassword(), request.captchaToken(),
                httpRequest.getRemoteAddr(), session == null ? null : session.getId());
    }

    /** 계정과 모든 메모를 지우고 로그아웃해요. */
    @DeleteMapping("/account")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAccount(@AuthenticationPrincipal LoginUser user, @Valid @RequestBody AccountDeleteRequest request,
                              HttpServletRequest httpRequest) {
        accountService.deleteAccount(user.id(), request.password(), request.captchaToken(), httpRequest.getRemoteAddr());
        SecurityContextHolder.clearContext();
        var session = httpRequest.getSession(false);
        if (session != null) {
            session.invalidate();
        }
    }

    @GetMapping("/me")
    public MeResponse me(@AuthenticationPrincipal LoginUser user) {
        return new MeResponse(user.id(), user.email());
    }

}
