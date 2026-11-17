package com.iokl1004.memoir.section;

import com.iokl1004.memoir.auth.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

@Entity
@Table(name = "sections")
public class Section {

    public static final String DEFAULT_NAME = "미분류";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /** 상위 섹션 id. 최상위면 null. 트리는 사용자의 섹션 전체를 한 번에 읽어 메모리에서 만들어요. */
    @Column(name = "parent_id")
    private Long parentId;

    @Column(nullable = false, length = 30)
    private String name;

    @Column(name = "is_default", nullable = false)
    private boolean defaultSection;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    protected Section() {
    }

    private Section(User user, Long parentId, String name, boolean defaultSection) {
        this.user = user;
        this.parentId = parentId;
        this.name = name;
        this.defaultSection = defaultSection;
        this.createdAt = LocalDateTime.now();
    }

    /** 가입할 때 자동으로 만들어지는, 삭제할 수 없는 "미분류" 섹션 */
    public static Section defaultOf(User user) {
        return new Section(user, null, DEFAULT_NAME, true);
    }

    /** 사용자가 직접 만드는 일반 섹션. parentId가 null이면 최상위 */
    public static Section of(User user, Long parentId, String name) {
        return new Section(user, parentId, name, false);
    }

    public void rename(String name) {
        this.name = name;
    }

    /** 다른 섹션 안으로 옮겨요. null이면 최상위 */
    public void moveTo(Long parentId) {
        this.parentId = parentId;
    }

    public Long getId() {
        return id;
    }

    public Long getParentId() {
        return parentId;
    }

    public String getName() {
        return name;
    }

    public boolean isDefaultSection() {
        return defaultSection;
    }
}
