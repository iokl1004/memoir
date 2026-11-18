package com.iokl1004.memoir.memo;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MemoTitlesTest {

    @Test
    void 숫자는_12자리로_맞추고_앞의_0은_뺀다() {
        assertThat(MemoTitles.sortKey("업무 일지 9")).isEqualTo("업무 일지 000000000009");
        assertThat(MemoTitles.sortKey("v1.10")).isEqualTo("v000000000001.000000000010");
        assertThat(MemoTitles.sortKey("007")).isEqualTo("000000000007");
        assertThat(MemoTitles.sortKey("0")).isEqualTo("000000000000");
        assertThat(MemoTitles.sortKey("숫자 없음")).isEqualTo("숫자 없음");
    }

    @Test
    void 정렬_값은_255자를_넘지_않는다() {
        assertThat(MemoTitles.sortKey("1 ".repeat(50))).hasSize(255);
    }
}
