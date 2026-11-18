package com.iokl1004.memoir.section;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SectionRepository extends JpaRepository<Section, Long> {

    List<Section> findByUserId(Long userId);

    /** 미분류가 맨 위, 나머지는 사용자가 정한 순서(같은 상위 안에서) */
    List<Section> findByUserIdOrderByDefaultSectionDescPositionAscIdAsc(Long userId);

    /** 같은 상위 섹션 안에서 가장 큰 순서 값. 새 섹션을 맨 아래에 두려고 써요. */
    @Query("SELECT COALESCE(MAX(s.position), 0) FROM Section s WHERE s.user.id = :userId "
            + "AND COALESCE(s.parentId, 0) = COALESCE(:parentId, 0)")
    long maxSiblingPosition(@Param("userId") Long userId, @Param("parentId") Long parentId);

    Optional<Section> findByIdAndUserId(Long id, Long userId);

    Optional<Section> findByUserIdAndDefaultSectionTrue(Long userId);

    /** 같은 부모 아래에 같은 이름이 있는지. parentId가 null이면 최상위에서 찾아요. */
    @Query("SELECT COUNT(s) > 0 FROM Section s WHERE s.user.id = :userId "
            + "AND COALESCE(s.parentId, 0) = COALESCE(:parentId, 0) AND s.name = :name")
    boolean existsSibling(@Param("userId") Long userId, @Param("parentId") Long parentId, @Param("name") String name);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM Memo m WHERE m.section.id IN :sectionIds AND m.user.id = :userId")
    int deleteMemos(@Param("userId") Long userId, @Param("sectionIds") Collection<Long> sectionIds);

    /** 섹션별 메모 개수. 메모가 없는 섹션은 결과에 없어요. */
    @Query("SELECT m.section.id AS sectionId, COUNT(m) AS memoCount FROM Memo m "
            + "WHERE m.user.id = :userId GROUP BY m.section.id")
    List<SectionMemoCount> countMemosBySection(@Param("userId") Long userId);

    interface SectionMemoCount {
        Long getSectionId();

        long getMemoCount();
    }
}
