package com.iokl1004.memoir.memo;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.safety.Cleaner;
import org.jsoup.safety.Safelist;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 편집기에서 온 본문 HTML을 정리해요.
 * - 서식 태그만 남기고 스크립트, 이벤트 속성, 스타일은 지워요. (다른 곳에서 붙여넣은 HTML도 여기를 거쳐요)
 * - 그림은 이 앱에 올린 그림(/api/images/{id})만 남겨요. 바깥 주소나 data: 그림은 지워요.
 * - 검색과 미리보기에 쓸 글자만 따로 뽑아요.
 */
final class MemoHtml {

    private static final Pattern IMAGE_SRC = Pattern.compile("^/api/images/(\\d+)$");
    private static final Safelist SAFELIST = Safelist.relaxed()
            // 그림 주소는 아래에서 직접 확인해요. (relaxed는 http, https만 허용해서 상대 주소를 지워요)
            .removeProtocols("img", "src", "http", "https")
            // 넓이·높이는 편집기에서 조절한 그림 크기라 남겨요.
            .removeAttributes("img", "align", "title");
    private static final String BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, tr";

    record Cleaned(String html, String text, Set<Long> imageIds) {
    }

    private MemoHtml() {
    }

    static Cleaned clean(String html) {
        Document dirty = Jsoup.parseBodyFragment(html);
        Document doc = new Cleaner(SAFELIST).clean(dirty);
        doc.outputSettings().prettyPrint(false);

        Set<Long> imageIds = new LinkedHashSet<>();
        for (Element img : doc.select("img")) {
            Matcher m = IMAGE_SRC.matcher(img.attr("src"));
            if (m.matches()) {
                imageIds.add(Long.parseLong(m.group(1)));
            } else {
                img.remove();
            }
        }
        return new Cleaned(doc.body().html(), textOf(doc), imageIds);
    }

    /** 문단과 줄바꿈을 살려서 글자만 뽑아요. */
    private static String textOf(Document doc) {
        Document copy = doc.clone();
        copy.select("br").after("\n");
        copy.select(BLOCKS).append("\n");
        return copy.body().wholeText().replaceAll("\n{3,}", "\n\n").strip();
    }
}
