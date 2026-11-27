// 인터넷이 없어도 앱 화면이 열리게 이 사이트의 파일(HTML, JS, CSS, 그림)을 브라우저에 남겨요.
// 메모 자체는 여기서 다루지 않아요(store.ts가 IndexedDB에 둬요). Supabase 같은 다른 주소의 요청도 건드리지 않아요.
// - 페이지: 먼저 서버에서 받고(새 배포를 바로 보여요), 안 되면 남겨 둔 것을 보여요.
// - 나머지 파일: 남겨 둔 것을 바로 쓰고, 뒤에서 새로 받아 바꿔 둬요.
// shortcut: 예전 배포의 파일(/assets/*-해시.js)이 계속 쌓여요. 한 번에 몇 백 KB라, 커지면 CACHE 이름을 바꿔 비워요.
const CACHE = 'memoir-v1'

// 처음 방문에서는 앱 파일이 이 일꾼보다 먼저 받아져서, 첫 화면이 쓰는 파일을 여기서 함께 남겨요.
async function precache() {
  const cache = await caches.open(CACHE)
  const res = await fetch('/', { cache: 'no-cache' })
  const html = await res.clone().text()
  await cache.put('/', res)
  const files = [...html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map(m => m[1])
  await cache.addAll([...new Set(files)])
}

self.addEventListener('install', event => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    // 주소 뒤의 ?app=desktop, ?reset=... 과 상관없이 같은 앱 화면이에요.
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)) }
          return res
        })
        .catch(() => caches.match('/').then(hit => hit ?? Response.error())),
    )
    return
  }

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      // 모듈 스크립트(crossorigin)는 요청 머리글이 달라도 같은 파일이라 주소로만 찾아요.
      const hit = await cache.match(req.url, { ignoreVary: true })
      const fresh = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone())
        return res
      })
      if (hit) { event.waitUntil(fresh.catch(() => undefined)); return hit }
      return fresh
    }),
  )
})
