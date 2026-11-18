package com.iokl1004.memoir.auth;

import com.iokl1004.memoir.auth.AuthDtos.LoginRequest;
import com.iokl1004.memoir.auth.AuthDtos.MeResponse;
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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
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
    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository securityContextRepository;

    public AuthController(AuthService authService, PasswordResetService passwordResetService,
                          AuthenticationManager authenticationManager, SecurityContextRepository securityContextRepository) {
        this.authService = authService;
        this.passwordResetService = passwordResetService;
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
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(request.email(), request.password()));
        } catch (AuthenticationException e) {
            // 이메일이 없는지, 비밀번호가 틀렸는지 구분하지 않아야 가입 여부가 새지 않아요.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "이메일 또는 비밀번호가 올바르지 않아요.");
        }

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

    /** 비밀번호 찾기 메일을 보내요. 가입 여부와 상관없이 늘 204예요. */
    @PostMapping("/password-reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void requestPasswordReset(@Valid @RequestBody PasswordResetRequest request) {
        passwordResetService.request(request.email());
    }

    /** 메일 링크의 토큰으로 새 비밀번호를 정해요. */
    @PostMapping("/password-reset/confirm")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void confirmPasswordReset(@Valid @RequestBody PasswordResetConfirm request) {
        passwordResetService.confirm(request.token(), request.password());
    }

    @GetMapping("/me")
    public MeResponse me(@AuthenticationPrincipal LoginUser user) {
        return new MeResponse(user.id(), user.email());
    }

}
