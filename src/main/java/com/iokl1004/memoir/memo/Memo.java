package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.auth.User;
import com.iokl1004.memoir.section.Section;
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
@Table(name = "memos")
public class Memo {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "section_id", nullable = false)
    private Section section;

    /** 사용자가 끌어서 정한 순서. 작을수록 위예요. 1024 간격으로 매기고, 사이에 끼울 자리가 없으면 다시 매겨요. */
    @Column(nullable = false)
    private long position;

    @Column(nullable = false, length = 100)
    private String title;

    /** 본문에서 글자만 뽑은 것. 검색과 목록 미리보기에 써요. */
    @Column(nullable = false, columnDefinition = "MEDIUMTEXT")
    private String content;

    /** 편집기의 본문(글자와 그림). 그림 기능 전에 쓴 메모는 null이에요. */
    @Column(columnDefinition = "MEDIUMTEXT")
    private String contentHtml;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    protected Memo() {
    }

    public Memo(User user, Section section, long position, String title, String content, String contentHtml) {
        this.user = user;
        this.section = section;
        this.position = position;
        this.title = title;
        this.content = content;
        this.contentHtml = contentHtml;
        this.createdAt = LocalDateTime.now();
        this.updatedAt = this.createdAt;
    }

    public void update(String title, String content, String contentHtml, Section section) {
        this.title = title;
        this.content = content;
        this.contentHtml = contentHtml;
        this.section = section;
        this.updatedAt = LocalDateTime.now();
    }

    /** 순서만 바꿔요. 내용을 고친 게 아니라서 수정일은 그대로 둬요. */
    public void moveTo(long position) {
        this.position = position;
    }

    public long getPosition() {
        return position;
    }

    public Long getId() {
        return id;
    }

    public Section getSection() {
        return section;
    }

    public String getTitle() {
        return title;
    }

    public String getContent() {
        return content;
    }

    public String getContentHtml() {
        return contentHtml;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }
}
