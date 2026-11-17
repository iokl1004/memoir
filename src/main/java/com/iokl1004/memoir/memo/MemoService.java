package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.auth.UserRepository;
import com.iokl1004.memoir.memo.MemoDtos.MemoCreateRequest;
import com.iokl1004.memoir.memo.MemoDtos.MemoPage;
import com.iokl1004.memoir.memo.MemoDtos.MemoResponse;
import com.iokl1004.memoir.memo.MemoDtos.MemoUpdateRequest;
import com.iokl1004.memoir.memo.search.MemoSearchCondition;
import com.iokl1004.memoir.memo.search.MemoSearcher;
import com.iokl1004.memoir.section.Section;
import com.iokl1004.memoir.section.SectionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class MemoService {

    private final MemoRepository memos;
    private final SectionRepository sections;
    private final UserRepository users;
    private final MemoSearcher searcher;

    public MemoService(MemoRepository memos, SectionRepository sections, UserRepository users, MemoSearcher searcher) {
        this.memos = memos;
        this.sections = sections;
        this.users = users;
        this.searcher = searcher;
    }

    @Transactional
    public MemoResponse create(Long userId, MemoCreateRequest request) {
        Section section = request.sectionId() == null ? defaultSection(userId) : ownedSection(userId, request.sectionId());
        Memo memo = memos.save(new Memo(users.getReferenceById(userId), section, request.title(), request.content()));
        return MemoResponse.from(memo);
    }

    @Transactional(readOnly = true)
    public MemoResponse get(Long userId, Long memoId) {
        return MemoResponse.from(ownedMemo(userId, memoId));
    }

    @Transactional
    public MemoResponse update(Long userId, Long memoId, MemoUpdateRequest request) {
        Memo memo = ownedMemo(userId, memoId);
        memo.update(
                request.title() != null ? request.title() : memo.getTitle(),
                request.content() != null ? request.content() : memo.getContent(),
                request.sectionId() != null ? ownedSection(userId, request.sectionId()) : memo.getSection());
        return MemoResponse.from(memo);
    }

    @Transactional
    public void delete(Long userId, Long memoId) {
        memos.delete(ownedMemo(userId, memoId));
    }

    @Transactional(readOnly = true)
    public MemoPage search(MemoSearchCondition condition) {
        if (condition.from() != null && condition.to() != null && condition.from().isAfter(condition.to())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "시작일이 종료일보다 늦어요.");
        }
        return MemoPage.from(searcher.search(condition));
    }

    private Memo ownedMemo(Long userId, Long memoId) {
        // 다른 사람의 메모도 "없음"으로 응답해서, 그 메모가 존재하는지조차 알 수 없게 해요.
        return memos.findByIdAndUserId(memoId, userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "메모를 찾을 수 없어요."));
    }

    private Section ownedSection(Long userId, Long sectionId) {
        return sections.findByIdAndUserId(sectionId, userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "섹션을 찾을 수 없어요."));
    }

    private Section defaultSection(Long userId) {
        return sections.findByUserIdAndDefaultSectionTrue(userId)
                .orElseThrow(() -> new IllegalStateException("미분류 섹션이 없는 사용자: " + userId));
    }
}
