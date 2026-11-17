"""검색 API(GET /api/memos)를 실제 HTTP로 여러 번 불러서 응답 시간을 재요.

사용법:
    python bench/run.py --label like            # 결과: bench/results/like.json
    python bench/run.py --label like --signup   # 처음 한 번: 측정 사용자 가입

- 측정 사용자: bench@memoir.test (bench DB 전용 테스트 계정)
- 쿼리마다 3번 데우고(warm-up) 20번 재서 p50, p95, 평균을 내요. 요청은 한 번에 하나씩 보내요.
- totalElements도 같이 남겨서, 검색 방식을 바꿔도 결과 개수가 같은지 비교해요.
"""
import argparse
import http.cookiejar
import json
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

EMAIL = "bench@memoir.test"
PASSWORD = "bench-password-2026!"  # bench DB 전용 테스트 비밀번호
WARMUP = 3
RUNS = 20


class Client:
    def __init__(self, base: str):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        try:
            self.opener.open(base + "/api/auth/me")
        except urllib.error.HTTPError:
            pass  # 401이어도 XSRF-TOKEN 쿠키는 받아요

    def call(self, method: str, path: str, body=None):
        xsrf = next((c.value for c in self.jar if c.name == "XSRF-TOKEN"), "")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json", "X-XSRF-TOKEN": xsrf})
        with self.opener.open(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None


def percentile(values, p):
    s = sorted(values)
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8081")
    ap.add_argument("--label", required=True)
    ap.add_argument("--signup", action="store_true")
    args = ap.parse_args()

    c = Client(args.base)
    cred = {"email": EMAIL, "password": PASSWORD}
    if args.signup:
        c.call("POST", "/api/auth/signup", cred)
    c.call("POST", "/api/auth/login", cred)
    if args.signup:
        print("측정 사용자를 만들었어요. 이제 seed.py로 데이터를 넣어 주세요.")
        return

    work = next(s["id"] for s in c.call("GET", "/api/sections") if s["name"] == "업무")
    queries = [
        ("목록 (조건 없음)", {}),
        ("흔한 단어 1개: 배포", {"q": "배포"}),
        ("드문 단어 1개: 마이그레이션", {"q": "마이그레이션"}),
        ("단어 2개: 배포 오류", {"q": "배포 오류"}),
        ("흔한 단어 + 섹션", {"q": "배포", "sectionId": work}),
        ("흔한 단어 + 기간 1개월", {"q": "배포", "from": "2026-06-01", "to": "2026-06-30"}),
        ("없는 단어: 블록체인", {"q": "블록체인"}),
    ]

    results = []
    for name, params in queries:
        path = "/api/memos?" + urllib.parse.urlencode(params)
        for _ in range(WARMUP):
            c.call("GET", path)
        times, total = [], None
        for _ in range(RUNS):
            t0 = time.perf_counter()
            page = c.call("GET", path)
            times.append((time.perf_counter() - t0) * 1000)
            total = page["totalElements"]
        results.append({"query": name, "params": params, "total": total,
                        "p50": round(percentile(times, .5), 1), "p95": round(percentile(times, .95), 1),
                        "mean": round(statistics.mean(times), 1)})
        r = results[-1]
        print(f"{name:<24} 결과 {r['total']:>7,}건   p50 {r['p50']:>8.1f}ms   p95 {r['p95']:>8.1f}ms")

    out = Path(__file__).parent / "results" / f"{args.label}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"저장: {out}")


if __name__ == "__main__":
    main()
