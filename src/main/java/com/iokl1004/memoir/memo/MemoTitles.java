package com.iokl1004.memoir.memo;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 제목 정렬 값. 숫자 부분의 자릿수를 맞춰서, 글자 순서로 비교해도 숫자는 크기 순서가 되게 해요. */
public final class MemoTitles {

    private static final Pattern DIGITS = Pattern.compile("\\d+");
    private static final int WIDTH = 12;
    private static final int MAX_LENGTH = 255;

    private MemoTitles() {
    }

    /** 예: "업무 일지 9" → "업무 일지 000000000009", "v1.10" → "v000000000001.000000000010" */
    public static String sortKey(String title) {
        Matcher m = DIGITS.matcher(title);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String n = m.group().replaceFirst("^0+(?=\\d)", "");
            m.appendReplacement(out, n.length() >= WIDTH ? n : "0".repeat(WIDTH - n.length()) + n);
        }
        m.appendTail(out);
        return out.length() <= MAX_LENGTH ? out.toString() : out.substring(0, MAX_LENGTH);
    }
}
