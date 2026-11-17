package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.auth.UserRepository;
import com.iokl1004.memoir.memo.MemoDtos.MemoCreateRequest;
import com.iokl1004.memoir.memo.MemoDtos.MemoPage;
import com.iokl1004.memoir.memo.MemoDtos.MemoResponse;
import com.iokl1004.memoir.memo.MemoDtos.MemoUpdateRequest;
import com.iokl1004.memoir.memo.search.MemoSearchCondition;
import com.iokl1004.memoir.memo.search.MemoSearcher;
import com.iokl1004.memoir.memo.search.MemoSort;
import com.iokl1004.memoir.section.Section;
import com.iokl1004.memoir.section.SectionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.Set;

@Service
public class MemoService {

    static final long POSITION_GAP = 1024;

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
        // 새 메모는 사용자가 정한 순서에서도 맨 위에 와요.
        long position = memos.minPosition(userId) - POSITION_GAP;
        Memo memo = memos.save(new Memo(users.getReferenceById(userId), section, position, request.title(), request.content()));
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

    /**
     * 메모를 afterId 메모 바로 아래, beforeId 메모 바로 위로 옮겨요. 화면에서 끌어 놓은 자리의 위아래 메모예요.
     * 하나만 주면 그 메모 옆으로 옮겨요. 사이에 끼울 자리가 없으면 순서 값을 다시 매긴 뒤 끼워요.
     */
    @Transactional
    public void move(Long userId, Long memoId, Long afterId, Long beforeId) {
        if (afterId == null && beforeId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "옮길 자리의 위나 아래 메모를 알려 주세요.");
        }
        if (memoId.equals(afterId) || memoId.equals(beforeId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "자기 자신 옆으로는 옮길 수 없어요.");
        }
        long position = slotBetween(userId, memoId, afterId, beforeId);
        if (position == Long.MIN_VALUE) {
            memos.renumberPositions(userId);
            position = slotBetween(userId, memoId, afterId, beforeId);
        }
        ownedMemo(userId, memoId).moveTo(position);
    }

    /** 끼울 자리의 순서 값. 자리가 없으면 Long.MIN_VALUE */
    private long slotBetween(Long userId, Long memoId, Long afterId, Long beforeId) {
        Long upper = afterId == null ? null : ownedMemo(userId, afterId).getPosition();
        Long lower = beforeId == null ? null : ownedMemo(userId, beforeId).getPosition();
        if (upper != null && lower != null && upper >= lower) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "위 메모가 아래 메모보다 앞에 있어야 해요.");
        }
        if (upper == null) {
            Long above = memos.positionAbove(userId, lower, memoId);
            upper = above != null ? above : lower - 2 * POSITION_GAP;
        }
        if (lower == null) {
            Long below = memos.positionBelow(userId, upper, memoId);
            lower = below != null ? below : upper + 2 * POSITION_GAP;
        }
        return lower - upper >= 2 ? upper + (lower - upper) / 2 : Long.MIN_VALUE;
    }

    @Transactional(readOnly = true)
    public MemoPage search(Long userId, Long sectionId, String q, LocalDate from, LocalDate to,
                           MemoSort sort, int page, int size) {
        if (from != null && to != null && from.isAfter(to)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "시작일이 종료일보다 늦어요.");
        }
        // 섹션을 고르면 그 섹션에 바로 쓴 메모만 보여줘요. 하위 섹션의 메모는 하위 섹션을 눌러서 봐요.
        Set<Long> sectionIds = sectionId == null ? null : Set.of(sectionId);
        return MemoPage.from(searcher.search(new MemoSearchCondition(
                userId, sectionIds, MemoSearchCondition.splitTerms(q), from, to, sort, page, size)), page);
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
