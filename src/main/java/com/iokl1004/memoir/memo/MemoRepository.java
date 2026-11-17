package com.iokl1004.memoir.memo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface MemoRepository extends JpaRepository<Memo, Long>, JpaSpecificationExecutor<Memo> {

    Optional<Memo> findByIdAndUserId(Long id, Long userId);
}
