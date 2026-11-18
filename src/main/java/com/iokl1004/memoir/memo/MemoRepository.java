package com.iokl1004.memoir.memo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface MemoRepository extends JpaRepository<Memo, Long> {

    Optional<Memo> findByIdAndUserId(Long id, Long userId);

    List<Memo> findAllByIdInAndUserId(Collection<Long> ids, Long userId);

    /** 새 메모를 사용자 순서의 맨 위에 두려고 가장 작은 순서 값을 찾아요. */
    @Query("SELECT COALESCE(MIN(m.position), 0) FROM Memo m WHERE m.user.id = :userId")
    long minPosition(@Param("userId") Long userId);

    /** 기준 값 바로 위(더 작은 값) 메모의 순서. 옮기는 메모 자신은 빼요. */
    @Query("SELECT MAX(m.position) FROM Memo m WHERE m.user.id = :userId AND m.position < :position AND m.id <> :exceptId")
    Long positionAbove(@Param("userId") Long userId, @Param("position") long position, @Param("exceptId") Long exceptId);

    /** 기준 값 바로 아래(더 큰 값) 메모의 순서. 옮기는 메모 자신은 빼요. */
    @Query("SELECT MIN(m.position) FROM Memo m WHERE m.user.id = :userId AND m.position > :position AND m.id <> :exceptId")
    Long positionBelow(@Param("userId") Long userId, @Param("position") long position, @Param("exceptId") Long exceptId);

    /** 끼울 자리가 없을 때 사용자의 메모 순서를 1024 간격으로 다시 매겨요. 순서는 그대로예요. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE memos m
              JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS rn FROM memos WHERE user_id = :userId) r
                ON r.id = m.id
               SET m.position = r.rn * 1024
            """, nativeQuery = true)
    int renumberPositions(@Param("userId") Long userId);
}
