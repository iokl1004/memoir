package com.iokl1004.memoir.section;

import com.iokl1004.memoir.auth.UserRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import com.iokl1004.memoir.section.SectionDtos.SectionListItem;
import com.iokl1004.memoir.section.SectionRepository.SectionMemoCount;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class SectionService {

    private final SectionRepository sections;
    private final UserRepository users;

    public SectionService(SectionRepository sections, UserRepository users) {
        this.sections = sections;
        this.users = users;
    }

    @Transactional(readOnly = true)
    public List<SectionListItem> list(Long userId) {
        Map<Long, Long> counts = sections.countMemosBySection(userId).stream()
                .collect(Collectors.toMap(SectionMemoCount::getSectionId, SectionMemoCount::getMemoCount));
        return sections.findByUserIdOrderByDefaultSectionDescCreatedAtAscIdAsc(userId).stream()
                .map(s -> new SectionListItem(s.getId(), s.getName(), s.isDefaultSection(),
                        counts.getOrDefault(s.getId(), 0L)))
                .toList();
    }

    @Transactional
    public Section create(Long userId, String name) {
        requireUniqueName(userId, name);
        try {
            return sections.saveAndFlush(Section.of(users.getReferenceById(userId), name));
        } catch (DataIntegrityViolationException e) {
            // 같은 이름으로 동시에 요청하면 위 검사를 둘 다 통과할 수 있어서, DB 유니크 제약으로 한 번 더 막아요.
            throw duplicateName();
        }
    }

    @Transactional
    public Section rename(Long userId, Long sectionId, String name) {
        Section section = findOwned(userId, sectionId);
        requireNotDefault(section);
        if (section.getName().equals(name)) {
            return section;
        }
        requireUniqueName(userId, name);
        section.rename(name);
        try {
            sections.flush();
        } catch (DataIntegrityViolationException e) {
            throw duplicateName();
        }
        return section;
    }

    /** 섹션 안의 메모를 미분류로 옮긴 뒤 섹션을 지워요. 둘 다 성공하거나 둘 다 취소돼요. */
    @Transactional
    public void delete(Long userId, Long sectionId) {
        Section section = findOwned(userId, sectionId);
        requireNotDefault(section);
        Section defaultSection = sections.findByUserIdAndDefaultSectionTrue(userId)
                .orElseThrow(() -> new IllegalStateException("미분류 섹션이 없는 사용자: " + userId));
        sections.moveMemos(userId, section.getId(), defaultSection.getId());
        sections.deleteById(section.getId());
    }

    private Section findOwned(Long userId, Long sectionId) {
        // 다른 사람의 섹션도 "없음"으로 응답해서, 그 섹션이 존재하는지조차 알 수 없게 해요.
        return sections.findByIdAndUserId(sectionId, userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "섹션을 찾을 수 없어요."));
    }

    private void requireUniqueName(Long userId, String name) {
        if (sections.existsByUserIdAndName(userId, name)) {
            throw duplicateName();
        }
    }

    private static void requireNotDefault(Section section) {
        if (section.isDefaultSection()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "미분류 섹션은 이름을 바꾸거나 삭제할 수 없어요.");
        }
    }

    private static ResponseStatusException duplicateName() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "같은 이름의 섹션이 이미 있어요.");
    }
}
