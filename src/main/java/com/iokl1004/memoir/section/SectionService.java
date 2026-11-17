package com.iokl1004.memoir.section;

import com.iokl1004.memoir.auth.UserRepository;
import com.iokl1004.memoir.section.SectionDtos.SectionListItem;
import com.iokl1004.memoir.section.SectionRepository.SectionMemoCount;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
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
                .map(s -> new SectionListItem(s.getId(), s.getParentId(), s.getName(), s.isDefaultSection(),
                        counts.getOrDefault(s.getId(), 0L)))
                .toList();
    }

    @Transactional
    public Section create(Long userId, String name, Long parentId) {
        if (parentId != null && findOwned(userId, parentId).isDefaultSection()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "미분류 안에는 섹션을 만들 수 없어요.");
        }
        requireUniqueName(userId, parentId, name);
        try {
            return sections.saveAndFlush(Section.of(users.getReferenceById(userId), parentId, name));
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
        requireUniqueName(userId, section.getParentId(), name);
        section.rename(name);
        try {
            sections.flush();
        } catch (DataIntegrityViolationException e) {
            throw duplicateName();
        }
        return section;
    }

    /**
     * 섹션과 그 아래 모든 하위 섹션을 지워요. 안에 있던 메모는 모두 미분류로 옮겨요.
     * 메모 이동과 섹션 삭제는 둘 다 성공하거나 둘 다 취소돼요.
     */
    @Transactional
    public void delete(Long userId, Long sectionId) {
        Section section = findOwned(userId, sectionId);
        requireNotDefault(section);
        Section defaultSection = sections.findByUserIdAndDefaultSectionTrue(userId)
                .orElseThrow(() -> new IllegalStateException("미분류 섹션이 없는 사용자: " + userId));

        List<Long> subtree = new ArrayList<>(subtree(sections.findByUserId(userId), section.getId()));
        sections.moveMemos(userId, subtree, defaultSection.getId());
        // 부모를 가리키는 FK 때문에 가장 깊은 섹션부터 지워요. (subtree는 위에서 아래 순서)
        for (Long id : subtree.reversed()) {
            sections.deleteById(id);
        }
    }

    /**
     * 섹션을 다른 섹션 안으로(newParentId), 또는 최상위로(null) 옮겨요. 하위 섹션과 메모는 함께 따라가요.
     * 자기 자신이나 자기 하위 섹션 안으로는 옮길 수 없어요(순환). 옮길 곳에 같은 이름이 있으면 409예요.
     */
    @Transactional
    public Section move(Long userId, Long sectionId, Long newParentId) {
        Section section = findOwned(userId, sectionId);
        if (section.isDefaultSection()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "미분류 섹션은 옮길 수 없어요.");
        }
        if (Objects.equals(section.getParentId(), newParentId)) {
            return section;
        }
        if (newParentId != null) {
            if (findOwned(userId, newParentId).isDefaultSection()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "미분류 안에는 섹션을 넣을 수 없어요.");
            }
            if (subtree(sections.findByUserId(userId), sectionId).contains(newParentId)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "자기 자신이나 하위 섹션 안으로는 옮길 수 없어요.");
            }
        }
        requireUniqueName(userId, newParentId, section.getName());
        section.moveTo(newParentId);
        try {
            sections.flush();
        } catch (DataIntegrityViolationException e) {
            throw duplicateName();
        }
        return section;
    }

    /** 위에서 아래로(BFS) 내려가며 모은 id. root가 목록에 없으면 빈 집합 */
    static Set<Long> subtree(List<Section> all, Long rootId) {
        Map<Long, List<Long>> children = new HashMap<>();
        boolean found = false;
        for (Section s : all) {
            found |= s.getId().equals(rootId);
            if (s.getParentId() != null) {
                children.computeIfAbsent(s.getParentId(), k -> new ArrayList<>()).add(s.getId());
            }
        }
        Set<Long> result = new LinkedHashSet<>();
        if (!found) {
            return result;
        }
        Deque<Long> queue = new ArrayDeque<>(List.of(rootId));
        while (!queue.isEmpty()) {
            Long id = queue.poll();
            if (result.add(id)) {
                queue.addAll(children.getOrDefault(id, List.of()));
            }
        }
        return result;
    }

    private Section findOwned(Long userId, Long sectionId) {
        // 다른 사람의 섹션도 "없음"으로 응답해서, 그 섹션이 존재하는지조차 알 수 없게 해요.
        return sections.findByIdAndUserId(sectionId, userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "섹션을 찾을 수 없어요."));
    }

    private void requireUniqueName(Long userId, Long parentId, String name) {
        if (sections.existsSibling(userId, parentId, name)) {
            throw duplicateName();
        }
    }

    private static void requireNotDefault(Section section) {
        if (section.isDefaultSection()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "미분류 섹션은 이름을 바꾸거나 삭제할 수 없어요.");
        }
    }

    private static ResponseStatusException duplicateName() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "같은 위치에 같은 이름의 섹션이 이미 있어요.");
    }
}
