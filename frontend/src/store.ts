// 이 기기의 메모 저장소. 화면은 여기서만 읽고 쓰고, 서버와는 뒤에서 맞춰요(오프라인 편집).
// - 읽기: 서버 사본(snapshot) + 보내지 않은 변경(outbox)을 계산한 값(view)을 바로 돌려줘요.
// - 쓰기: view에 먼저 반영하고 outbox에 넣은 뒤, 연결되면 차례로 서버에 보내요(offline.ts의 flushOp).
// - 자동 로그인을 켰으면 IndexedDB에 남겨서 새로 열어도, 인터넷이 없어도 그대로예요. 끄면 이 탭의 메모리에만 둬요.
// - 탭 여러 개: IndexedDB를 함께 쓰고, 보내기는 Web Locks로 한 탭씩, 바뀌면 BroadcastChannel로 서로 알려요.
import { useSyncExternalStore } from 'react'
import { remote, type Memo, type MemoFilter, type MemoPage, type MemoSort, type MemoSummary, type Section, type User } from './api'
import { shrinkImage } from './images'
import {
  ApiError, applyEffects, applyOp, cloneData, flushOp, listSections, replay, searchMemos, tempId, toMemo, trashMemos,
  type Data, type Effect, type FlushContext, type MemoBody, type MemoRow, type Op,
} from './offline'
import { AUTO_LOGIN_KEY } from './supabase'

type Entry = { seq: number; op: Op }
type Session = {
  user: User
  name: string
  /** null이면 이 기기에 남기지 않아요(자동 로그인 끔). */
  db: IDBDatabase | null
  snapshot: Data
  view: Data
  outbox: Entry[]
  idMap: Map<number, number>
  /** 이 기기에서 저장한 시각 → 서버 수정 시각 */
  stamps: Map<string, string>
  memImages: Map<number, Blob>
  urls: Map<number, string>
  seq: number
  running: Promise<void> | null
  again: boolean
  /** 마지막 보내기가 연결 문제로 멈췄어요. */
  unreachable: boolean
  lastPull: number
  retry?: ReturnType<typeof setTimeout>
  channel: BroadcastChannel | null
  dispose: () => void
}

const empty = (): Data => ({ sections: new Map(), memos: new Map() })
const now = () => new Date().toISOString()
let s: Session | null = null
let ready: Promise<void> = Promise.resolve()
const events = new EventTarget()

// ------------------------------------------------------------------ IndexedDB

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
}

function openDb(name: string): Promise<IDBDatabase> {
  const r = indexedDB.open(name, 1)
  r.onupgradeneeded = () => {
    const db = r.result
    db.createObjectStore('memos', { keyPath: 'id' })
    db.createObjectStore('sections', { keyPath: 'id' })
    db.createObjectStore('outbox', { autoIncrement: true })
    db.createObjectStore('images')
    db.createObjectStore('meta')
  }
  return req(r)
}

function write(db: IDBDatabase, stores: string[], fn: (t: IDBTransaction) => void): Promise<void> {
  return new Promise((ok, no) => {
    const t = db.transaction(stores, 'readwrite')
    fn(t)
    t.oncomplete = () => ok()
    t.onerror = t.onabort = () => no(t.error)
  })
}

/** 바뀐 줄만 IndexedDB에 써요. 바뀐 줄은 새 객체라서 객체가 같은지로 알아요. */
async function persist(me: Session, before: Data, after: Data): Promise<boolean> {
  const diff = (a: Map<number, object>, b: Map<number, object>) => ({
    put: [...b].filter(([id, row]) => a.get(id) !== row).map(([, row]) => row),
    del: [...a.keys()].filter(id => !b.has(id)),
  })
  const memos = diff(before.memos, after.memos)
  const sections = diff(before.sections, after.sections)
  const changed = memos.put.length + memos.del.length + sections.put.length + sections.del.length > 0
  if (me.db && changed) {
    await write(me.db, ['memos', 'sections'], t => {
      for (const [name, d] of [['memos', memos], ['sections', sections]] as const) {
        const store = t.objectStore(name)
        d.put.forEach(row => store.put(row))
        d.del.forEach(id => store.delete(id))
      }
    })
  }
  return changed
}

/** IndexedDB에서 다시 읽어요. 다른 탭이 바꿨을 때, 보내기 전에 써요. */
async function load(me: Session) {
  if (!me.db) return
  const t = me.db.transaction(['memos', 'sections', 'outbox', 'meta'])
  const [memos, sections, keys, ops, idMap] = await Promise.all([
    req(t.objectStore('memos').getAll() as IDBRequest<MemoRow[]>),
    req(t.objectStore('sections').getAll()),
    req(t.objectStore('outbox').getAllKeys()),
    req(t.objectStore('outbox').getAll() as IDBRequest<Op[]>),
    req(t.objectStore('meta').get('idMap') as IDBRequest<[number, number][] | undefined>),
  ])
  if (s !== me) return
  // 화면이 아직 임시 번호를 들고 있을 수 있어서, 아는 번호는 지우지 않고 더하기만 해요.
  for (const [from, to] of idMap ?? []) me.idMap.set(from, to)
  me.snapshot = { memos: new Map(memos.map(m => [m.id, m])), sections: new Map(sections.map(x => [x.id, x])) }
  me.outbox = keys.map((seq, i) => ({ seq: seq as number, op: ops[i] }))
  me.view = replay(me.snapshot, me.outbox.map(e => e.op), resolve)
}

async function getImage(me: Session, id: number): Promise<Blob | undefined> {
  return me.memImages.get(id) ?? (me.db ? req(me.db.transaction('images').objectStore('images').get(id)) : undefined)
}

async function putImage(me: Session, id: number, blob: Blob) {
  if (me.db) await write(me.db, ['images'], t => t.objectStore('images').put(blob, id))
  else me.memImages.set(id, blob)
}

// ------------------------------------------------------------------ 상태 알리기

let status = { pending: 0, offline: false, syncing: false }
function emitStatus() {
  const next = s
    ? { pending: s.outbox.length, offline: !navigator.onLine || s.unreachable, syncing: !!s.running }
    : { pending: 0, offline: false, syncing: false }
  if (next.pending === status.pending && next.offline === status.offline && next.syncing === status.syncing) return
  status = next
  events.dispatchEvent(new Event('status'))
}

function emit(type: 'change' | 'notice' | 'replaced' | 'auth', detail?: unknown) {
  events.dispatchEvent(new CustomEvent(type, { detail }))
}

/** 다른 기기에서 고친 메모와 겹쳐 사본을 만들었거나, 지워진 메모를 새로 살렸어요. */
export type Replaced = { from: number; row: Memo }

export function onStore(type: 'change', fn: () => void): () => void
export function onStore(type: 'notice', fn: (message: string) => void): () => void
export function onStore(type: 'replaced', fn: (r: Replaced) => void): () => void
export function onStore(type: 'auth', fn: () => void): () => void
export function onStore(type: string, fn: (detail: never) => void): () => void {
  const listener = (e: Event) => fn((e as CustomEvent).detail as never)
  events.addEventListener(type, listener)
  return () => events.removeEventListener(type, listener)
}

/** 보내지 않은 변경 수와 연결 상태. 위쪽 막대에 보여줘요. */
export function useSyncStatus() {
  return useSyncExternalStore(
    notify => { events.addEventListener('status', notify); return () => events.removeEventListener('status', notify) },
    () => status,
  )
}

/** 임시 번호를 서버 번호로. 화면이 들고 있는 번호는 오래돼도 이걸로 맞춰요. */
export function resolve(id: number): number {
  let x = id
  for (let i = 0; s?.idMap.has(x) && i < 10; i++) x = s.idMap.get(x)!
  return x
}

// ------------------------------------------------------------------ 순서 지키기

let chain: Promise<unknown> = Promise.resolve()
/** 상태를 바꾸는 일은 하나씩 해요. (네트워크를 기다리는 동안에는 잡지 않아요) */
function exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
  const p = chain.then(fn)
  chain = p.catch(() => undefined)
  return p
}

function need(): Session {
  if (!s) throw new ApiError(401, '로그인이 필요해요.')
  return s
}

function changed(me: Session) {
  emitStatus()
  emit('change')
  me.channel?.postMessage('changed')
}

/** 이 탭이나 다른 탭이 지금 보내는 중이에요. 보내는 중인 변경은 고치면 안 돼요. */
async function sending(me: Session): Promise<boolean> {
  if (me.running) return true
  if (!me.db || !navigator.locks) return false
  return !!(await navigator.locks.query()).held?.some(l => l.name === me.name)
}

function mutate(op: Op): Promise<void> {
  return exclusive(async () => {
    const me = need()
    const next = cloneData(me.view)
    applyOp(next, op, resolve)
    const last = me.outbox.at(-1)
    if (op.type === 'saveMemo' && last?.op.type === 'saveMemo' && resolve(last.op.id) === resolve(op.id) && !(await sending(me))) {
      // 자동 저장이 잦아서, 아직 보내지 않은 같은 메모 저장은 하나로 합쳐요. 기준(base)은 처음 것을 그대로 둬요.
      const merged: Op = { ...op, id: last.op.id, base: last.op.base }
      if (me.db) await write(me.db, ['outbox'], t => t.objectStore('outbox').put(merged, last.seq))
      last.op = merged
    } else {
      const seq = me.db ? Number(await req(me.db.transaction('outbox', 'readwrite').objectStore('outbox').add(op))) : ++me.seq
      me.outbox.push({ seq, op })
    }
    me.view = next
    changed(me)
    void sync(me, false)
  })
}

// ------------------------------------------------------------------ 서버와 맞추기

/** later: 사본·새 메모 알림은 서버 사본에 반영한 뒤에 보내요(화면이 바로 그 메모를 찾아요). */
function context(me: Session, later: Replaced[]): FlushContext {
  return {
    resolve,
    map: (from, to) => { me.idMap.set(from, to) },
    stamp: local => me.stamps.get(local) ?? local,
    stamped: (local, server) => { me.stamps.set(local, server) },
    image: id => getImage(me, id),
    notice: message => emit('notice', message),
    replaced: (from, row) => { later.push({ from, row: toMemo(row) }) },
  }
}

/** 보내지 않은 변경을 차례로 보내고, 다 보냈으면 서버 사본을 새로 받아요. */
function sync(me: Session | null, pull = true): Promise<void> {
  if (!me) return Promise.resolve()
  if (me.running) { me.again = true; return me.running }
  const run = async () => {
    do {
      me.again = false
      const ok = await flush(me)
      if (s !== me) return
      if (ok && (pull || Date.now() - me.lastPull > 300_000)) await pullAll(me).catch(() => { me.unreachable = true })
    } while (me.again && s === me)
  }
  const locked = () => (me.db && navigator.locks ? navigator.locks.request(me.name, run) : run())
  me.running = Promise.resolve(locked()).finally(() => {
    me.running = null
    emitStatus()
    if (s === me && me.outbox.length) me.retry = setTimeout(() => sync(me, false), 30_000)
  })
  emitStatus()
  return me.running
}

/** 다 보냈으면 true. 연결이 안 되거나 로그인이 만료되면 멈추고 false예요. */
async function flush(me: Session): Promise<boolean> {
  clearTimeout(me.retry)
  await exclusive(() => load(me))
  while (me.outbox.length && s === me) {
    const { seq, op } = me.outbox[0]
    let effects: Effect[]
    const later: Replaced[] = []
    try {
      effects = await flushOp(op, remote, context(me, later))
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { emit('auth'); return false }
      if (!(e instanceof ApiError) || e.status >= 500) { me.unreachable = true; emitStatus(); return false }
      emit('notice', `서버에 반영하지 못한 변경이 있어요. ${e.message}`)
      effects = []
    }
    me.unreachable = false
    await exclusive(async () => {
      const next = applyEffects(me.snapshot, effects, resolve)
      await persist(me, me.snapshot, next)
      me.snapshot = next
      me.outbox = me.outbox.filter(e => e.seq !== seq)
      const real = op.type === 'image' ? resolve(op.id) : 0
      if (op.type === 'image' && real > 0) {
        const blob = await getImage(me, op.id)
        if (blob) await putImage(me, real, blob)
      }
      if (me.db) {
        await write(me.db, ['outbox', 'meta', 'images'], t => {
          t.objectStore('outbox').delete(seq)
          t.objectStore('meta').put([...me.idMap], 'idMap')
          if (op.type === 'image' && real > 0) t.objectStore('images').delete(op.id)
        })
      }
      me.view = replay(me.snapshot, me.outbox.map(e => e.op), resolve)
      changed(me)
    })
    later.forEach(r => emit('replaced', r))
  }
  return true
}

const sameRow = (a: object | undefined, b: object) => !!a && JSON.stringify(a) === JSON.stringify(b)

/** 서버 사본을 새로 받아요. 메모는 번호와 수정 시각만 먼저 받고, 바뀐 메모의 본문만 받아요. */
async function pullAll(me: Session) {
  const [sections, index] = await Promise.all([remote.sections(), remote.memoIndex()])
  const stale = index.filter(x => me.snapshot.memos.get(x.id)?.updatedAt !== x.updatedAt).map(x => x.id)
  const fresh = new Map((await remote.memosByIds(stale)).map(m => [m.id, m]))
  await exclusive(async () => {
    if (s !== me) return
    const old = me.snapshot
    const memos = new Map<number, MemoRow>()
    for (const x of index) {
      const row = fresh.get(x.id) ?? old.memos.get(x.id)
      if (!row) continue
      const same = row.sectionId === x.sectionId && row.position === x.position && row.pinned === x.pinned && row.deletedAt === x.deletedAt
      memos.set(x.id, same ? row : { ...row, sectionId: x.sectionId, position: x.position, pinned: x.pinned, deletedAt: x.deletedAt })
    }
    const next: Data = {
      memos,
      sections: new Map(sections.map(x => [x.id, sameRow(old.sections.get(x.id), x) ? old.sections.get(x.id)! : x])),
    }
    me.lastPull = Date.now()
    me.unreachable = false
    if (!(await persist(me, old, next))) { emitStatus(); return }
    me.snapshot = next
    me.view = replay(next, me.outbox.map(e => e.op), resolve)
    changed(me)
  })
}

// ------------------------------------------------------------------ 열고 닫기

function close() {
  if (!s) return
  s.dispose()
  s = null
  emitStatus()
}

/** 로그인한 사용자의 저장소를 열어요. 처음이면 서버에서 다 받을 때까지 기다려요. */
function open(user: User): Promise<void> {
  if (s?.user.id === user.id) return ready
  close()
  const name = `memoir-${user.id}`
  const me: Session = {
    user, name, db: null, snapshot: empty(), view: empty(), outbox: [], idMap: new Map(), stamps: new Map(),
    memImages: new Map(), urls: new Map(), seq: 0, running: null, again: false, unreachable: false, lastPull: 0,
    channel: null, dispose: () => undefined,
  }
  s = me
  const online = () => { emitStatus(); void sync(me) }
  const visible = () => { if (document.visibilityState === 'visible' && Date.now() - me.lastPull > 30_000) void sync(me) }
  const timer = setInterval(visible, 300_000)
  // 이 기기에 남기지 않을 때는 보내지 못한 변경이 탭을 닫으면 사라지니 한 번 물어봐요.
  const unload = (e: BeforeUnloadEvent) => { if (!me.db && me.outbox.length) e.preventDefault() }
  window.addEventListener('online', online)
  window.addEventListener('offline', emitStatus)
  window.addEventListener('beforeunload', unload)
  document.addEventListener('visibilitychange', visible)
  me.dispose = () => {
    clearInterval(timer)
    clearTimeout(me.retry)
    window.removeEventListener('online', online)
    window.removeEventListener('offline', emitStatus)
    window.removeEventListener('beforeunload', unload)
    document.removeEventListener('visibilitychange', visible)
    me.channel?.close()
    me.db?.close()
    for (const url of me.urls.values()) URL.revokeObjectURL(url)
  }

  ready = (async () => {
    const keep = localStorage.getItem(AUTO_LOGIN_KEY) !== '0'
      || !!(await indexedDB.databases?.().catch(() => []))?.some(d => d.name === name)
    if (keep) {
      const db = await openDb(name).catch(() => null)
      if (s !== me) { db?.close(); return }
      // 다른 탭이 로그아웃하며 저장소를 지우려 하면 바로 놓아 줘요(안 놓으면 지우기가 막혀요).
      if (db) db.onversionchange = () => { db.close(); if (me.db === db) me.db = null }
      me.db = db
      await exclusive(() => load(me))
      if (db) {
        me.channel = new BroadcastChannel(name)
        me.channel.onmessage = () => { void exclusive(() => load(me)).then(() => { emitStatus(); emit('change') }) }
      }
    }
    emitStatus()
    const first = sync(me)
    if (!me.snapshot.sections.size) await first
  })()
  return ready
}

/** 로그아웃, 계정 삭제: 이 기기에 남긴 메모와 그림도 지워요. */
async function destroy() {
  const name = s?.name
  close()
  if (!name) return
  // 다른 탭이 아직 쓰고 있으면(blocked) 그 탭이 놓는 대로 지워져요. 로그아웃은 기다리지 않아요.
  await new Promise<void>(done => {
    const r = indexedDB.deleteDatabase(name)
    r.onsuccess = r.onerror = r.onblocked = () => done()
  })
}

async function view(): Promise<{ me: Session; d: Data }> {
  // 기다리는 사이 다시 열었으면(로그인 바뀜, 개발 모드의 두 번 실행) 새 것을 기다려요.
  for (let r = ready; ; r = ready) { await r; if (r === ready) break }
  const me = need()
  return { me, d: me.view }
}

export const store = {
  open,
  close,
  destroy,
  /** 지금 바로 보내고 받아요. 끝나면 돌아와요. */
  sync: () => sync(s),
  /** 보내지 않은 변경 수 */
  pending: () => s?.outbox.length ?? 0,

  sections: async (): Promise<Section[]> => listSections((await view()).d),
  memos: async (filter: MemoFilter, sort: MemoSort, page: number, size = 20): Promise<MemoPage> => {
    const { d } = await view()
    return searchMemos(d, { ...filter, sectionId: filter.sectionId === undefined ? undefined : resolve(filter.sectionId) }, sort, page, size)
  },
  memo: async (id: number): Promise<Memo> => {
    const row = (await view()).d.memos.get(resolve(id))
    if (!row) throw new ApiError(404, '메모를 찾을 수 없어요.')
    return toMemo(row)
  },

  createSection: (name: string, parentId: number | null) => mutate({ type: 'createSection', id: tempId(), name, parentId, at: now() }),
  renameSection: (id: number, name: string) => mutate({ type: 'renameSection', id, name }),
  /** 하위 섹션까지 지우고, 안의 메모는 미분류로 옮겨 휴지통에 넣어요. */
  deleteSection: (id: number) => mutate({ type: 'deleteSection', id, at: now() }),
  /** parentId가 null이면 최상위, beforeId가 null이면 그 안의 맨 아래로 옮겨요. */
  moveSection: (id: number, parentId: number | null, beforeId: number | null = null) =>
    mutate({ type: 'moveSection', id, parentId, beforeId }),

  createMemo: async (body: MemoBody): Promise<Memo> => {
    const id = tempId()
    await mutate({ type: 'saveMemo', id, body, base: null, at: now() })
    return store.memo(id)
  },
  /** base: 편집기가 처음 불러온 메모. 보낼 때 서버 메모가 이것과 다르면 내 내용을 사본으로 따로 저장해요. */
  updateMemo: async (id: number, body: MemoBody, base: Memo): Promise<Memo> => {
    await mutate({ type: 'saveMemo', id, body, base: { updatedAt: base.updatedAt, title: base.title, html: base.contentHtml }, at: now() })
    return store.memo(id)
  },
  deleteMemos: async (ids: number[]) => {
    const { me } = await view()
    const bases: Record<number, string> = {}
    for (const id of ids.map(resolve)) {
      const stamp = me.snapshot.memos.get(id)?.updatedAt
      if (stamp) bases[id] = stamp
    }
    return mutate({ type: 'deleteMemos', ids, bases, at: now() })
  },
  /** 휴지통: 최근에 넣은 것부터. 30일이 지나면 서버가 지워요. */
  trash: async (): Promise<MemoSummary[]> => trashMemos((await view()).d),
  restoreMemos: (ids: number[]) => mutate({ type: 'restoreMemos', ids }),
  purgeMemos: (ids: number[]) => mutate({ type: 'purgeMemos', ids }),
  pinMemos: (ids: number[], pinned: boolean) => mutate({ type: 'pinMemos', ids, pinned }),
  deleteMemo: (id: number) => store.deleteMemos([id]),
  /** 여러 메모를 한 섹션으로 옮겨요. 수정일도 바뀌어요. */
  moveMemos: (ids: number[], sectionId: number) => mutate({ type: 'moveMemos', ids, sectionId, at: now() }),
  /** 끌어 놓은 자리의 위(afterId)와 아래(beforeId) 메모 */
  moveMemo: (id: number, afterId: number | null, beforeId: number | null) => mutate({ type: 'moveMemo', id, afterId, beforeId }),

  /** 그림을 줄여서 이 기기에 먼저 두고, 연결되면 올려요. 돌려받은 번호(임시면 음수)를 본문에 적어요. */
  uploadImage: async (file: Blob): Promise<{ id: number }> => {
    const { me } = await view()
    const blob = await shrinkImage(file)
    const id = tempId()
    await putImage(me, id, blob)
    await mutate({ type: 'image', id })
    return { id }
  },
  /** 편집기에 보여줄 그림 주소. 한 번 본 그림은 이 기기에 남겨서 오프라인에서도 보여요. */
  imageSrc: async (raw: number): Promise<string> => {
    const { me } = await view()
    const id = resolve(raw)
    const hit = me.urls.get(id) ?? me.urls.get(raw)
    if (hit) return hit
    let blob = (await getImage(me, id)) ?? (await getImage(me, raw))
    if (!blob && id > 0) {
      blob = await remote.imageBlob(id).catch(() => undefined)
      if (blob) await putImage(me, id, blob).catch(() => undefined)
    }
    if (!blob || s !== me) return ''
    const url = URL.createObjectURL(blob)
    me.urls.set(id, url)
    return url
  },
}
