package com.iokl1004.memoir.memo;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Page;

import java.time.LocalDateTime;
import java.util.List;

final class MemoDtos {

    static final String UNTITLED = "제목 없음";
    private static final int PREVIEW_LENGTH = 100;

    private MemoDtos() {
    }

    /** sectionId가 없으면 미분류에 저장해요. 제목이 비어 있으면 "제목 없음"으로 저장해요. */
    record MemoCreateRequest(Long sectionId,
                             @Size(max = 100) String title,
                             @NotNull @Size(max = 20_000) String content) {

        MemoCreateRequest {
            title = normalizeTitle(title);
        }
    }

    /** 보낸 항목만 바꿔요. null인 항목은 그대로 둬요. */
    record MemoUpdateRequest(Long sectionId,
                             @Size(max = 100) String title,
                             @Size(max = 20_000) String content) {

        MemoUpdateRequest {
            title = title == null ? null : normalizeTitle(title);
        }
    }

    record MemoResponse(Long id, Long sectionId, String title, String content,
                        LocalDateTime createdAt, LocalDateTime updatedAt) {

        static MemoResponse from(Memo memo) {
            return new MemoResponse(memo.getId(), memo.getSection().getId(), memo.getTitle(), memo.getContent(),
                    memo.getCreatedAt(), memo.getUpdatedAt());
        }
    }

    record MemoSummary(Long id, Long sectionId, String title, String preview,
                       LocalDateTime createdAt, LocalDateTime updatedAt) {

        static MemoSummary from(Memo memo) {
            return new MemoSummary(memo.getId(), memo.getSection().getId(), memo.getTitle(), previewOf(memo.getContent()),
                    memo.getCreatedAt(), memo.getUpdatedAt());
        }
    }

    record MemoPage(List<MemoSummary> items, int page, int totalPages, long totalElements) {

        static MemoPage from(Page<Memo> page) {
            return new MemoPage(page.map(MemoSummary::from).getContent(),
                    page.getNumber(), page.getTotalPages(), page.getTotalElements());
        }
    }

    private static String normalizeTitle(String title) {
        return title == null || title.isBlank() ? UNTITLED : title.trim();
    }

    /** 목록에 보여줄 본문 앞부분. 줄바꿈과 연속 공백은 한 칸으로 줄여요. */
    private static String previewOf(String content) {
        String flat = content.strip().replaceAll("\\s+", " ");
        return flat.length() <= PREVIEW_LENGTH ? flat : flat.substring(0, PREVIEW_LENGTH);
    }
}
