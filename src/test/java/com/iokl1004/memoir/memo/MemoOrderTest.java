package com.iokl1004.memoir.memo;

import com.iokl1004.memoir.TestcontainersConfiguration;
import com.iokl1004.memoir.support.Api;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 정렬 기준과, 끌어서 정하는 사용자 지정 순서 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class MemoOrderTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    Api api;
    long a;
    long b;
    long c;
    long d;

    @BeforeEach
    void 메모_네_개를_만든다() throws Exception {
        api = Api.signupAndLogin(mvc);
        a = api.createMemo(null, "다람쥐");
        b = api.createMemo(null, "가나다");
        c = api.createMemo(null, "바다");
        d = api.createMemo(null, "Apple");
        // 작성일과 수정일을 서로 다른 순서로 맞춰요.
        setDates(a, "2026-01-01", "2026-04-01");
        setDates(b, "2026-02-01", "2026-01-15");
        setDates(c, "2026-03-01", "2026-02-15");
        setDates(d, "2026-04-01", "2026-03-15");
    }

    @Test
    void 정렬_기준마다_순서가_바뀐다() throws Exception {
        assertThat(api.titles("sort=CREATED_DESC")).containsExactly("Apple", "바다", "가나다", "다람쥐");
        assertThat(api.titles("sort=CREATED_ASC")).containsExactly("다람쥐", "가나다", "바다", "Apple");
        assertThat(api.titles("sort=UPDATED_DESC")).containsExactly("다람쥐", "Apple", "바다", "가나다");
        assertThat(api.titles("sort=UPDATED_ASC")).containsExactly("가나다", "바다", "Apple", "다람쥐");
        assertThat(api.titles("sort=TITLE_ASC")).containsExactly("Apple", "가나다", "다람쥐", "바다");
        assertThat(api.titles("sort=TITLE_DESC")).containsExactly("바다", "다람쥐", "가나다", "Apple");
        api.perform(get("/api/memos?sort=WRONG")).andExpect(status().isBadRequest());
    }

    @Test
    void 사용자_지정_순서는_새_메모가_맨_위이고_끌어서_바꿀_수_있다() throws Exception {
        assertThat(api.titles("sort=CUSTOM")).containsExactly("Apple", "바다", "가나다", "다람쥐");

        api.move(a, d, c).andExpect(status().isNoContent());        // 다람쥐를 Apple과 바다 사이로
        assertThat(api.titles("sort=CUSTOM")).containsExactly("Apple", "다람쥐", "바다", "가나다");

        api.move(b, null, d).andExpect(status().isNoContent());     // 가나다를 맨 위로
        assertThat(api.titles("sort=CUSTOM")).containsExactly("가나다", "Apple", "다람쥐", "바다");

        api.move(d, c, null).andExpect(status().isNoContent());     // Apple을 맨 아래로
        assertThat(api.titles("sort=CUSTOM")).containsExactly("가나다", "다람쥐", "바다", "Apple");
    }

    @Test
    void 끼울_자리가_없으면_번호를_다시_매기고_순서는_지킨다() throws Exception {
        // 바다(c)와 가나다(b)를 바로 붙여서 사이에 자리가 없게 만들어요.
        long cPos = jdbc.queryForObject("SELECT position FROM memos WHERE id = ?", Long.class, c);
        jdbc.update("UPDATE memos SET position = ? WHERE id = ?", cPos + 1, b);

        api.move(d, c, b).andExpect(status().isNoContent());
        assertThat(api.titles("sort=CUSTOM")).containsExactly("바다", "Apple", "가나다", "다람쥐");
        List<Long> positions = jdbc.queryForList(
                "SELECT position FROM memos WHERE id IN (?, ?, ?, ?) ORDER BY position", Long.class, a, b, c, d);
        assertThat(positions).doesNotHaveDuplicates();
    }

    @Test
    void 순서를_바꿔도_수정일은_그대로다() throws Exception {
        api.move(a, d, c).andExpect(status().isNoContent());
        api.perform(get("/api/memos/{id}", a)).andExpect(jsonPath("$.updatedAt").value("2026-04-01T00:00:00"));
    }

    @Test
    void 잘못된_자리는_400이고_남의_메모는_404() throws Exception {
        api.move(a, null, null).andExpect(status().isBadRequest());
        api.move(a, a, null).andExpect(status().isBadRequest());
        api.move(a, b, d).andExpect(status().isBadRequest());       // 가나다가 Apple보다 아래에 있어요

        Api other = Api.signupAndLogin(mvc);
        other.move(a, null, null).andExpect(status().isBadRequest());
        long mine = other.createMemo(null, "내 메모");
        other.move(mine, null, a).andExpect(status().isNotFound());
        other.move(a, mine, null).andExpect(status().isNotFound());
    }

    private void setDates(long id, String created, String updated) {
        jdbc.update("UPDATE memos SET created_at = ?, updated_at = ? WHERE id = ?",
                created + " 00:00:00", updated + " 00:00:00", id);
    }
}
