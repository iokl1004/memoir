package com.iokl1004.memoir.section;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

final class SectionDtos {

    private SectionDtos() {
    }

    /** parentId가 없으면 최상위에 만들어요. 앞뒤 공백은 검증 전에 지워요. */
    record SectionCreateRequest(@NotBlank @Size(max = 30) String name, Long parentId) {

        SectionCreateRequest {
            name = name == null ? null : name.trim();
        }
    }

    record SectionNameRequest(@NotBlank @Size(max = 30) String name) {

        SectionNameRequest {
            name = name == null ? null : name.trim();
        }
    }

    record SectionResponse(Long id, Long parentId, String name, boolean isDefault) {

        static SectionResponse from(Section section) {
            return new SectionResponse(section.getId(), section.getParentId(), section.getName(), section.isDefaultSection());
        }
    }

    /** memoCount는 이 섹션에 바로 쓴 메모 수예요. 하위 섹션까지 합친 수는 화면에서 트리로 더해요. */
    record SectionListItem(Long id, Long parentId, String name, boolean isDefault, long memoCount) {
    }
}
