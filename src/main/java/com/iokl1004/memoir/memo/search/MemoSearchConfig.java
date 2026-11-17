package com.iokl1004.memoir.memo.search;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MemoSearchConfig {

    /** memoir.search.engine = auto(기본) | like | fulltext. 성능 측정 때 방식별로 바꿔 띄워요. */
    @Bean
    MemoSearcher memoSearcher(@Value("${memoir.search.engine:auto}") String engine, MemoSql sql) {
        return switch (engine) {
            case "auto" -> new AdaptiveMemoSearcher(sql);
            case "like" -> new LikeMemoSearcher(sql);
            case "fulltext" -> new FulltextMemoSearcher(sql);
            default -> throw new IllegalArgumentException("memoir.search.engine은 auto, like, fulltext 중 하나예요: " + engine);
        };
    }
}
