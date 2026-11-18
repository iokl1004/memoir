package com.iokl1004.memoir.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false, length = 60)
    private String password;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    protected User() {
    }

    public User(String email, String encodedPassword) {
        this.email = email;
        this.password = encodedPassword;
        this.createdAt = LocalDateTime.now();
    }

    /** 패스워드 찾기로 새 패스워드를 정할 때만 써요. 이미 암호화된 값을 받아요. */
    public void changePassword(String encodedPassword) {
        this.password = encodedPassword;
    }

    public Long getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getPassword() {
        return password;
    }
}
