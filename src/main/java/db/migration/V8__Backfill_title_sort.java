package db.migration;

import com.iokl1004.memoir.memo.MemoTitles;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;

/** 기존 메모의 title_sort(V7)를 채워요. 숫자 자릿수 맞추기는 SQL로 하기 어려워서 앱과 같은 코드를 써요. */
public class V8__Backfill_title_sort extends BaseJavaMigration {

    private static final int BATCH = 1000;

    @Override
    public void migrate(Context context) throws Exception {
        try (Statement select = context.getConnection().createStatement();
             PreparedStatement update = context.getConnection().prepareStatement("UPDATE memos SET title_sort = ? WHERE id = ?")) {
            int pending = 0;
            try (ResultSet rows = select.executeQuery("SELECT id, title FROM memos")) {
                while (rows.next()) {
                    update.setString(1, MemoTitles.sortKey(rows.getString("title")));
                    update.setLong(2, rows.getLong("id"));
                    update.addBatch();
                    if (++pending == BATCH) {
                        update.executeBatch();
                        pending = 0;
                    }
                }
            }
            if (pending > 0) {
                update.executeBatch();
            }
        }
    }
}
