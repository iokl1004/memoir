package com.iokl1004.memoir.section;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SectionRepository extends JpaRepository<Section, Long> {

    List<Section> findByUserId(Long userId);

    /** 미분류가 맨 위, 나머지는 만든 순서대로 */
    List<Section> findByUserIdOrderByDefaultSectionDescCreatedAtAscIdAsc(Long userId);

    Optional<Section> findByIdAndUserId(Long id, Long userId);

    Optional<Section> findByUserIdAndDefaultSectionTrue(Long userId);

    boolean existsByUserIdAndName(Long userId, String name);

    // shortcut: Memo 엔티티가 아직 없어서 네이티브 쿼리로 옮겨요. 메모 기능을 만들 때 JPQL로 바꿔요.
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "UPDATE memos SET section_id = :toSectionId WHERE section_id = :fromSectionId AND user_id = :userId",
            nativeQuery = true)
    int moveMemos(@Param("userId") Long userId,
                  @Param("fromSectionId") Long fromSectionId,
                  @Param("toSectionId") Long toSectionId);
}
