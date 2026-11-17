package com.iokl1004.memoir.auth;

import com.iokl1004.memoir.section.Section;
import com.iokl1004.memoir.section.SectionRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {

    private final UserRepository users;
    private final SectionRepository sections;
    private final PasswordEncoder passwordEncoder;

    public AuthService(UserRepository users, SectionRepository sections, PasswordEncoder passwordEncoder) {
        this.users = users;
        this.sections = sections;
        this.passwordEncoder = passwordEncoder;
    }

    /** 회원을 만들고, 같은 트랜잭션에서 "미분류" 섹션도 함께 만들어요. */
    @Transactional
    public User signup(String email, String rawPassword) {
        if (users.existsByEmail(email)) {
            throw duplicateEmail();
        }
        User user;
        try {
            user = users.saveAndFlush(new User(email, passwordEncoder.encode(rawPassword)));
        } catch (DataIntegrityViolationException e) {
            // 같은 이메일로 동시에 가입하면 위 검사를 둘 다 통과할 수 있어서, DB 유니크 제약으로 한 번 더 막아요.
            throw duplicateEmail();
        }
        sections.save(Section.defaultOf(user));
        return user;
    }

    private static ResponseStatusException duplicateEmail() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "이미 가입된 이메일이에요.");
    }
}
