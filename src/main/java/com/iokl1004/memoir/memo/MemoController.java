package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.auth.LoginUser;
import com.iokl1004.memoir.memo.MemoDtos.MemoCreateRequest;
import com.iokl1004.memoir.memo.MemoDtos.MemoPage;
import com.iokl1004.memoir.memo.MemoDtos.MemoResponse;
import com.iokl1004.memoir.memo.MemoDtos.MemoUpdateRequest;
import com.iokl1004.memoir.memo.MemoDtos.MemoMoveRequest;
import com.iokl1004.memoir.memo.search.MemoSort;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@RestController
@RequestMapping("/api/memos")
public class MemoController {

    private static final int PAGE_SIZE = 20;

    private final MemoService memoService;

    public MemoController(MemoService memoService) {
        this.memoService = memoService;
    }

    /** 목록과 검색을 한 곳에서 처리해요. 조건을 안 주면 전체 메모를 최신순으로 보여줘요. */
    @GetMapping
    public MemoPage search(@AuthenticationPrincipal LoginUser user,
                           @RequestParam(required = false) Long sectionId,
                           @RequestParam(required = false) @Size(max = 100) String q,
                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                           @RequestParam(defaultValue = "CREATED_DESC") MemoSort sort,
                           @RequestParam(defaultValue = "0") @Min(0) int page) {
        return memoService.search(user.id(), sectionId, q, from, to, sort, page, PAGE_SIZE);
    }

    /** 사용자 지정 순서에서 메모를 끌어 놓은 자리로 옮겨요. */
    @PutMapping("/{id}/position")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void move(@AuthenticationPrincipal LoginUser user, @PathVariable Long id,
                     @RequestBody MemoMoveRequest request) {
        memoService.move(user.id(), id, request.afterId(), request.beforeId());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public MemoResponse create(@AuthenticationPrincipal LoginUser user, @Valid @RequestBody MemoCreateRequest request) {
        return memoService.create(user.id(), request);
    }

    @GetMapping("/{id}")
    public MemoResponse get(@AuthenticationPrincipal LoginUser user, @PathVariable Long id) {
        return memoService.get(user.id(), id);
    }

    @PatchMapping("/{id}")
    public MemoResponse update(@AuthenticationPrincipal LoginUser user, @PathVariable Long id,
                               @Valid @RequestBody MemoUpdateRequest request) {
        return memoService.update(user.id(), id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal LoginUser user, @PathVariable Long id) {
        memoService.delete(user.id(), id);
    }
}
