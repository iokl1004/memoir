package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.memo.search.MemoSearchResult;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;
import java.util.List;

final class MemoDtos {

    static final String UNTITLED = "제목 없음";
    private static final int PREVIEW_LENGTH = 100;
    /** 본문 글자 수 제한 */
    static final int MAX_CONTENT = 20_000;
    /** HTML은 태그가 붙어서 길어져요. 그림은 주소만 들어가요. */
    static final int MAX_HTML = 200_000;

    private MemoDtos() {
    }

    /**
     * sectionId가 없으면 미분류에 저장해요. 제목이 비어 있으면 "제목 없음"으로 저장해요.
     * 본문은 contentHtml(글자와 그림)이나 content(글자만) 중 하나로 보내요. 둘 다 오면 contentHtml을 써요.
     */
    record MemoCreateRequest(Long sectionId,
                             @Size(max = 100) String title,
                             @Size(max = MAX_CONTENT) String content,
                             @Size(max = MAX_HTML) String contentHtml) {

        MemoCreateRequest {
            title = normalizeTitle(title);
        }
    }

    /** 보낸 항목만 바꿔요. null인 항목은 그대로 둬요. */
    record MemoUpdateRequest(Long sectionId,
                             @Size(max = 100) String title,
                             @Size(max = MAX_CONTENT) String content,
                             @Size(max = MAX_HTML) String contentHtml) {

        MemoUpdateRequest {
            title = title == null ? null : normalizeTitle(title);
        }
    }

    record MemoResponse(Long id, Long sectionId, String title, String content, String contentHtml,
                        LocalDateTime createdAt, LocalDateTime updatedAt) {

        static MemoResponse from(Memo memo) {
            return new MemoResponse(memo.getId(), memo.getSection().getId(), memo.getTitle(), memo.getContent(),
                    memo.getContentHtml(), memo.getCreatedAt(), memo.getUpdatedAt());
        }
    }

    record MemoSummary(Long id, Long sectionId, String title, String preview,
                       LocalDateTime createdAt, LocalDateTime updatedAt) {

        static MemoSummary from(Memo memo) {
            return new MemoSummary(memo.getId(), memo.getSection().getId(), memo.getTitle(), previewOf(memo.getContent()),
                    memo.getCreatedAt(), memo.getUpdatedAt());
        }
    }

    /** totalCapped이면 total은 "이 수 이상"이에요. 다음 페이지가 있는지는 hasNext로 판단해요. */
    record MemoPage(List<MemoSummary> items, int page, long total, boolean totalCapped, boolean hasNext) {

        static MemoPage from(MemoSearchResult result, int page) {
            return new MemoPage(result.items().stream().map(MemoSummary::from).toList(),
                    page, result.total(), result.totalCapped(), result.hasNext());
        }
    }

    /** 여러 메모를 한 번에 옮기거나 지울 때. 옮길 때만 sectionId가 필요해요. */
    record MemoBulkRequest(@NotEmpty @Size(max = 500) List<@NotNull Long> ids, Long sectionId) {
    }

    /** 끌어 놓은 자리의 위(afterId)와 아래(beforeId) 메모. 맨 위나 맨 아래면 한쪽만 와요. */
    record MemoMoveRequest(Long afterId, Long beforeId) {
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
