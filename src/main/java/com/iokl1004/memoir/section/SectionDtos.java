package com.iokl1004.memoir.section;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

final class SectionDtos {

    private SectionDtos() {
    }

    /** 생성과 이름 변경에 같이 써요. 앞뒤 공백은 검증 전에 지워요. */
    record SectionNameRequest(@NotBlank @Size(max = 30) String name) {

        SectionNameRequest {
            name = name == null ? null : name.trim();
        }
    }

    record SectionResponse(Long id, String name, boolean isDefault) {

        static SectionResponse from(Section section) {
            return new SectionResponse(section.getId(), section.getName(), section.isDefaultSection());
        }
    }
}
