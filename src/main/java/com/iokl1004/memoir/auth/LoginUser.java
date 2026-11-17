package com.iokl1004.memoir.auth;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;

/** 세션에 저장되는 로그인 사용자. 컨트롤러에서 @AuthenticationPrincipal로 꺼내 써요. */
public record LoginUser(Long id, String email, String password) implements UserDetails {

    static LoginUser from(User user) {
        return new LoginUser(user.getId(), user.getEmail(), user.getPassword());
    }

    @Override
    public String getUsername() {
        return email;
    }

    @Override
    public String getPassword() {
        return password;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of();
    }
}
