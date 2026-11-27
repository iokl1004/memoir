// 오프라인 편집의 계산 부분. 서버(Supabase)를 부르지 않아서 시험(offline.test.ts)으로 확인해요.
// 화면은 언제나 "서버에서 받은 사본(snapshot) + 아직 보내지 않은 변경(outbox)"을 이 기기에서 계산해 보여줘요.
// 서버 함수(supabase/migrations)의 규칙과 문구를 그대로 따라 해서, 오프라인에서도 같은 오류가 나요.
import type { Memo, MemoFilter, MemoPage, MemoSort, MemoSummary, Section } from './api'

/** 화면에 그대로 보여줄 문구와 HTTP 상태. 401이면 로그인 화면으로 돌아가요. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type MemoRow = Memo & { position: number }
export type SectionRow = Omit<Section, 'memoCount'> & { position: number }
export type Data = { sections: Map<number, SectionRow>; memos: Map<number, MemoRow> }
/** 편집을 시작한 때의 서버 메모. 보낼 때 서버 메모가 이것과 다르면 다른 기기에서 고친 거예요. */
export type Base = { updatedAt: string; title: string; html: string | null }
export type MemoBody = { sectionId: number; title: string; contentHtml: string; content: string }

/** 이 기기에서 만든 것은 서버 번호를 받기 전까지 음수 번호(임시)를 써요. 탭 여러 개가 겹치지 않게 무작위예요. */
export const tempId = () => -Math.floor(Math.random() * 2 ** 52) - 1

export type Op =
  | { type: 'createSection'; id: number; name: string; parentId: number | null; at: string }
  | { type: 'renameSection'; id: number; name: string }
  /** 하위 섹션까지 지우고, 안의 메모는 미분류로 옮겨 휴지통에 넣어요. (at은 예전 기록에는 없어요) */
  | { type: 'deleteSection'; id: number; at?: string }
  | { type: 'moveSection'; id: number; parentId: number | null; beforeId: number | null }
  | { type: 'saveMemo'; id: number; body: MemoBody; base: Base | null; at: string }
  | { type: 'moveMemos'; ids: number[]; sectionId: number; at: string }
  /** 휴지통으로. bases: 지울 때 알고 있던 서버 수정 시각. 그 뒤에 다른 기기에서 고친 메모는 지우지 않아요. */
  | { type: 'deleteMemos'; ids: number[]; bases: Record<number, string>; at?: string }
  | { type: 'restoreMemos'; ids: number[] }
  /** 휴지통에서 완전히 지워요. */
  | { type: 'purgeMemos'; ids: number[] }
  | { type: 'pinMemos'; ids: number[]; pinned: boolean }
  | { type: 'moveMemo'; id: number; afterId: number | null; beforeId: number | null }
  | { type: 'image'; id: number }

/** 임시 번호 → 서버 번호 */
export type Resolve = (id: number) => number

const bad = (message: string) => new ApiError(400, message)
const NO_SECTION = '섹션을 찾을 수 없어요.'
const DUP_SECTION = '같은 위치에 같은 이름의 섹션이 이미 있어요.'
/** Postgres btrim처럼 앞뒤 공백만 지워요. */
const btrim = (s: string) => s.replace(/^ +| +$/g, '')
export const memoTitle = (t: string) => btrim(t) || '제목 없음'
const time = (s: string) => Date.parse(s)

export const toMemo = (r: MemoRow): Memo => ({
  id: r.id, sectionId: r.sectionId, title: r.title, content: r.content, contentHtml: r.contentHtml,
  createdAt: r.createdAt, updatedAt: r.updatedAt, pinned: r.pinned, deletedAt: r.deletedAt,
})

export const cloneData = (d: Data): Data => ({ sections: new Map(d.sections), memos: new Map(d.memos) })

function subtree(d: Data, id: number): Set<number> {
  const ids = new Set([id])
  for (let grew = true; grew;) {
    grew = false
    for (const s of d.sections.values()) {
      if (s.parentId !== null && ids.has(s.parentId) && !ids.has(s.id)) { ids.add(s.id); grew = true }
    }
  }
  return ids
}

const siblings = (d: Data, parentId: number | null, except?: number) =>
  [...d.sections.values()].filter(s => s.parentId === parentId && s.id !== except)

function checkName(d: Data, name: string, parentId: number | null, except?: number): string {
  const n = btrim(name)
  if (n.length < 1 || n.length > 30) throw bad('섹션 이름은 1~30자로 적어 주세요.')
  if (siblings(d, parentId, except).some(s => s.name === n)) throw bad(DUP_SECTION)
  return n
}

function checkParent(d: Data, parentId: number | null, moving?: number) {
  if (parentId === null) return
  const parent = d.sections.get(parentId)
  if (!parent) throw bad(NO_SECTION)
  if (parent.isDefault) throw bad('미분류 안에는 섹션을 넣을 수 없어요.')
  if (moving !== undefined && subtree(d, moving).has(parentId)) throw bad('자기 자신이나 하위 섹션 안으로는 옮길 수 없어요.')
}

const defaultSection = (d: Data) => [...d.sections.values()].find(s => s.isDefault)

/**
 * 변경 하나를 d에 바로 반영해요(d는 복사본이어야 해요). 규칙에 어긋나면 아무것도 바꾸지 않고 ApiError를 던져요.
 * 메모 쪽은 너그럽게: 그 사이 다른 기기에서 섹션이나 메모가 지워졌어도 쓴 내용이 화면에서 사라지지 않게 해요.
 */
export function applyOp(d: Data, op: Op, r: Resolve): void {
  switch (op.type) {
    case 'createSection': {
      const parentId = op.parentId === null ? null : r(op.parentId)
      checkParent(d, parentId)
      const name = checkName(d, op.name, parentId)
      if (d.sections.size >= 1000) throw bad('섹션은 한 사람에 1,000개까지 만들 수 있어요.')
      const position = Math.max(0, ...siblings(d, parentId).map(s => s.position)) + 1024
      const id = r(op.id)
      d.sections.set(id, { id, parentId, name, isDefault: false, position, createdAt: op.at })
      return
    }
    case 'renameSection': {
      const s = d.sections.get(r(op.id))
      if (!s) throw bad(NO_SECTION)
      if (s.isDefault) throw bad('미분류 섹션은 이름을 바꾸거나 옮길 수 없어요.')
      d.sections.set(s.id, { ...s, name: checkName(d, op.name, s.parentId, s.id) })
      return
    }
    case 'deleteSection': {
      const s = d.sections.get(r(op.id))
      if (!s) throw bad(NO_SECTION)
      if (s.isDefault) throw bad('미분류 섹션은 이름을 바꾸거나 삭제할 수 없어요.')
      const ids = subtree(d, s.id)
      const fallback = defaultSection(d)!.id
      for (const id of ids) d.sections.delete(id)
      const at = op.at ?? new Date().toISOString()
      for (const m of d.memos.values()) {
        if (ids.has(m.sectionId)) d.memos.set(m.id, { ...m, sectionId: fallback, deletedAt: m.deletedAt ?? at })
      }
      return
    }
    case 'moveSection': {
      const s = d.sections.get(r(op.id))
      if (!s) throw bad(NO_SECTION)
      if (s.isDefault) throw bad('미분류 섹션은 옮길 수 없어요.')
      const parentId = op.parentId === null ? null : r(op.parentId)
      checkParent(d, parentId, s.id)
      if (parentId !== s.parentId) checkName(d, s.name, parentId, s.id)
      const order = siblings(d, parentId, s.id).filter(x => !x.isDefault)
        .sort((a, b) => a.position - b.position || a.id - b.id)
      const before = op.beforeId === null ? -1 : order.findIndex(x => x.id === r(op.beforeId!))
      if (op.beforeId !== null && before < 0) throw bad('옮길 곳에 그 섹션이 없어요.')
      order.splice(before < 0 ? order.length : before, 0, { ...s, parentId })
      order.forEach((x, i) => d.sections.set(x.id, { ...x, position: (i + 1) * 1024 }))
      return
    }
    case 'saveMemo': {
      const b = op.body
      if (b.content.length > 20000) throw bad('본문은 20,000자까지 쓸 수 있어요.')
      if (b.title.length > 100) throw bad('제목은 100자까지 쓸 수 있어요.')
      const sectionId = d.sections.has(r(b.sectionId)) ? r(b.sectionId) : defaultSection(d)?.id
      if (sectionId === undefined) throw bad(NO_SECTION)
      const id = r(op.id)
      const old = d.memos.get(id)
      // 고치면 휴지통에서 나와요(save_memo와 같아요).
      const fields = { sectionId, title: memoTitle(b.title), content: b.content, contentHtml: b.contentHtml, updatedAt: op.at, deletedAt: null }
      if (old) {
        d.memos.set(id, { ...old, ...fields })
        return
      }
      if (d.memos.size >= 10000) throw bad('메모는 한 사람에 10,000개까지 쓸 수 있어요. 안 쓰는 메모를 지운 뒤 다시 시도해 주세요.')
      const position = Math.min(0, ...[...d.memos.values()].map(m => m.position)) - 1024
      d.memos.set(id, { id, position, createdAt: op.at, pinned: false, ...fields })
      return
    }
    case 'moveMemos': {
      const sectionId = r(op.sectionId)
      if (!d.sections.has(sectionId)) throw bad(NO_SECTION)
      for (const raw of op.ids) {
        const m = d.memos.get(r(raw))
        if (m && m.sectionId !== sectionId) d.memos.set(m.id, { ...m, sectionId, updatedAt: op.at })
      }
      return
    }
    case 'deleteMemos':
    case 'restoreMemos':
    case 'purgeMemos':
    case 'pinMemos': {
      const at = (op.type === 'deleteMemos' && op.at) || new Date().toISOString()
      for (const raw of op.ids) {
        const m = d.memos.get(r(raw))
        if (!m) continue
        if (op.type === 'deleteMemos' && !m.deletedAt) d.memos.set(m.id, { ...m, deletedAt: at })
        if (op.type === 'restoreMemos' && m.deletedAt) d.memos.set(m.id, { ...m, deletedAt: null })
        if (op.type === 'purgeMemos' && m.deletedAt) d.memos.delete(m.id)
        if (op.type === 'pinMemos' && m.pinned !== op.pinned) d.memos.set(m.id, { ...m, pinned: op.pinned })
      }
      return
    }
    case 'moveMemo': {
      const m = d.memos.get(r(op.id))
      if (!m) return
      const all = [...d.memos.values()].filter(x => x.id !== m.id).sort((a, b) => a.position - b.position || a.id - b.id)
      const after = op.afterId === null ? -1 : all.findIndex(x => x.id === r(op.afterId!))
      const before = op.beforeId === null ? -1 : all.findIndex(x => x.id === r(op.beforeId!))
      const at = after >= 0 ? after + 1 : before >= 0 ? before : -1
      if (at < 0) return
      all.splice(at, 0, m)
      all.forEach((x, i) => { if (x.position !== (i + 1) * 1024) d.memos.set(x.id, { ...x, position: (i + 1) * 1024 }) })
      return
    }
    case 'image':
      return
  }
}

/** 서버 사본 위에 보내지 않은 변경을 차례로 얹어요. 이제는 맞지 않는 변경(지워진 섹션 이름 바꾸기 등)은 건너뛰어요. */
export function replay(snapshot: Data, ops: Op[], r: Resolve): Data {
  const d = cloneData(snapshot)
  for (const op of ops) {
    try { applyOp(d, op, r) } catch { /* 보낼 때 서버도 거절하고, 그때 알려줘요 */ }
  }
  return d
}

/** list_sections와 같은 순서(미분류 먼저, 정한 순서)와 메모 수 */
export function listSections(d: Data): Section[] {
  const counts = new Map<number, number>()
  for (const m of d.memos.values()) if (!m.deletedAt) counts.set(m.sectionId, (counts.get(m.sectionId) ?? 0) + 1)
  return [...d.sections.values()]
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.position - b.position || a.id - b.id)
    .map(s => ({ id: s.id, parentId: s.parentId, name: s.name, isDefault: s.isDefault, createdAt: s.createdAt, memoCount: counts.get(s.id) ?? 0 }))
}

/** title_sort_key와 같아요: 숫자를 12자리로 맞춰 "9"가 "22"보다 앞에 와요. */
export const titleSortKey = (t: string) => t.replace(/\d+/g, n => n.replace(/^0+/, '').padStart(12, '0')).slice(0, 255)

const SORTS: Record<MemoSort, (a: MemoRow, b: MemoRow) => number> = {
  CREATED_DESC: (a, b) => time(b.createdAt) - time(a.createdAt) || b.id - a.id,
  CREATED_ASC: (a, b) => time(a.createdAt) - time(b.createdAt) || a.id - b.id,
  UPDATED_DESC: (a, b) => time(b.updatedAt) - time(a.updatedAt) || b.id - a.id,
  UPDATED_ASC: (a, b) => time(a.updatedAt) - time(b.updatedAt) || a.id - b.id,
  TITLE_ASC: (a, b) => cmp(titleSortKey(a.title), titleSortKey(b.title)) || a.id - b.id,
  TITLE_DESC: (a, b) => cmp(titleSortKey(b.title), titleSortKey(a.title)) || b.id - a.id,
  CUSTOM: (a, b) => a.position - b.position || a.id - b.id,
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
/** 한국 날짜의 0시 */
const kstDay = (date: string, plusDays = 0) => Date.parse(`${date}T00:00:00+09:00`) + plusDays * 86_400_000

/** search_memos와 같아요. 다만 이 기기에 다 있으니 전체 수를 끝까지 세요. */
export function searchMemos(d: Data, f: MemoFilter, sort: MemoSort, page: number, size: number): MemoPage {
  if (f.from && f.to && f.from > f.to) throw bad('시작일이 종료일보다 늦어요.')
  const terms = [...new Set((f.q ?? '').trim().split(/\s+/).filter(Boolean).map(t => t.toLowerCase()))]
  const from = f.from ? kstDay(f.from) : -Infinity
  const to = f.to ? kstDay(f.to, 1) : Infinity
  const hits = [...d.memos.values()].filter(m => {
    if (m.deletedAt) return false
    if (f.sectionId !== undefined && m.sectionId !== f.sectionId) return false
    const created = time(m.createdAt)
    if (created < from || created >= to) return false
    const title = m.title.toLowerCase()
    const content = m.content.toLowerCase()
    return terms.every(t => title.includes(t) || content.includes(t))
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || SORTS[sort](a, b)) // 고정한 메모는 맨 위
  const items = hits.slice(page * size, (page + 1) * size).map(summary)
  return { items, page, total: hits.length, totalCapped: false, hasNext: hits.length > (page + 1) * size }
}

const summary = (m: MemoRow): MemoSummary => ({
  id: m.id, sectionId: m.sectionId, title: m.title, createdAt: m.createdAt, updatedAt: m.updatedAt,
  pinned: m.pinned, deletedAt: m.deletedAt, preview: m.content.replace(/\s+/g, ' ').trim().slice(0, 100),
})

/** 휴지통: 최근에 넣은 것부터 */
export const trashMemos = (d: Data): MemoSummary[] =>
  [...d.memos.values()].filter(m => m.deletedAt).sort((a, b) => time(b.deletedAt!) - time(a.deletedAt!) || b.id - a.id).map(summary)

/** 서버에 보내는 일. 시험에서는 가짜로 바꿔 끼워요. */
export type Remote = {
  createSection(name: string, parentId: number | null): Promise<SectionRow>
  renameSection(id: number, name: string): Promise<void>
  deleteSection(id: number): Promise<void>
  moveSection(id: number, parentId: number | null, beforeId: number | null): Promise<void>
  sections(): Promise<SectionRow[]>
  /** sectionId가 null이면 서버가 미분류에 넣어요. id가 null이면 새로 만들어요. */
  saveMemo(id: number | null, body: Omit<MemoBody, 'sectionId'> & { sectionId: number | null }): Promise<MemoRow>
  /** 메모마다 서버의 수정 시각. 지워진 메모는 빠져요. */
  memoStamps(ids: number[]): Promise<Map<number, string>>
  memo(id: number): Promise<MemoRow | null>
  moveMemos(ids: number[], sectionId: number): Promise<void>
  deleteMemos(ids: number[]): Promise<void>
  moveMemo(id: number, afterId: number | null, beforeId: number | null): Promise<void>
  restoreMemos(ids: number[]): Promise<void>
  purgeMemos(ids: number[]): Promise<void>
  pinMemos(ids: number[], pinned: boolean): Promise<void>
  uploadImage(blob: Blob): Promise<number>
}

/** 보내고 난 뒤 서버 사본에 반영할 일 */
export type Effect = { put: MemoRow } | { putSection: SectionRow } | { remove: number } | { apply: Op }

export type FlushContext = {
  resolve: Resolve
  /** 임시 번호(또는 지워진 메모 번호) → 서버 번호 */
  map(from: number, to: number): void
  /** 이 기기에서 저장한 시각 → 서버가 매긴 수정 시각. 편집기가 들고 있는 기준 시각을 맞출 때 써요. */
  stamp(local: string): string
  stamped(local: string, server: string): void
  image(id: number): Promise<Blob | undefined>
  notice(message: string): void
  /** 다른 기기에서 고친 메모와 겹쳐 사본을 만들었거나, 지워진 메모를 새로 살렸어요. */
  replaced(from: number, row: MemoRow): void
}

const isRejected = (e: unknown, message?: string) =>
  e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && (!message || e.message === message)

/** 본문의 임시 그림 번호(/img/-12)를 서버 번호로 바꿔요. 못 올린 그림은 그대로 둬요(빈 그림으로 보여요). */
export const resolveImages = (html: string, r: Resolve) =>
  html.replace(/\/img\/(-\d+)"/g, (whole, id: string) => (r(Number(id)) > 0 ? `/img/${r(Number(id))}"` : whole))

const copyTitle = (t: string) => `${memoTitle(t).slice(0, 92)} (충돌 사본)`

/**
 * 변경 하나를 서버에 보내요. 서버가 거절하면(지워진 섹션, 개수 제한 등) 알림을 남기고 버리고,
 * 연결이 안 되거나 로그인이 만료되면 오류를 그대로 던져서 대기열에 남겨요.
 */
export async function flushOp(op: Op, remote: Remote, ctx: FlushContext): Promise<Effect[]> {
  const r = ctx.resolve
  const known = (id: number) => r(id) > 0
  switch (op.type) {
    case 'image': {
      const blob = await ctx.image(op.id)
      if (!blob) return []
      try {
        ctx.map(op.id, await remote.uploadImage(blob))
      } catch (e) {
        if (!isRejected(e)) throw e
        ctx.notice(`그림을 올리지 못했어요. ${(e as ApiError).message}`)
      }
      return []
    }
    case 'createSection': {
      let parentId = op.parentId === null ? null : r(op.parentId)
      if (parentId !== null && parentId < 0) parentId = null
      for (;;) {
        try {
          const row = await remote.createSection(op.name, parentId)
          ctx.map(op.id, row.id)
          return [{ putSection: row }]
        } catch (e) {
          if (isRejected(e, DUP_SECTION)) {
            const same = (await remote.sections()).find(s => s.parentId === parentId && s.name === btrim(op.name))
            if (same) {
              ctx.map(op.id, same.id)
              ctx.notice(`'${same.name}' 섹션이 이미 있어서, 이 기기에서 만든 섹션을 그 섹션에 합쳤어요.`)
              return [{ putSection: same }]
            }
          }
          if (isRejected(e, NO_SECTION) && parentId !== null) { parentId = null; continue }
          if (!isRejected(e)) throw e
          ctx.notice(`'${op.name}' 섹션을 만들지 못했어요. ${(e as ApiError).message} 그 안의 메모는 미분류에 넣어요.`)
          return []
        }
      }
    }
    case 'renameSection':
    case 'deleteSection':
    case 'moveSection': {
      if (!known(op.id) || (op.type === 'moveSection' && ((op.parentId !== null && !known(op.parentId)) || (op.beforeId !== null && !known(op.beforeId))))) return []
      try {
        if (op.type === 'renameSection') await remote.renameSection(r(op.id), op.name)
        else if (op.type === 'deleteSection') await remote.deleteSection(r(op.id))
        else await remote.moveSection(r(op.id), op.parentId === null ? null : r(op.parentId), op.beforeId === null ? null : r(op.beforeId))
        return [{ apply: op }]
      } catch (e) {
        if (!isRejected(e)) throw e
        // 지우려던 섹션이 이미 없으면 바라던 대로예요.
        if (!(op.type === 'deleteSection' && isRejected(e, NO_SECTION))) {
          ctx.notice(`이 기기에서 바꾼 섹션을 서버에 반영하지 못했어요. ${(e as ApiError).message}`)
        }
        return []
      }
    }
    case 'saveMemo': {
      const body = {
        ...op.body,
        sectionId: known(op.body.sectionId) ? r(op.body.sectionId) : null,
        contentHtml: resolveImages(op.body.contentHtml, r),
      }
      // 섹션이 그 사이 지워졌으면 미분류에 넣어서라도 쓴 내용을 지켜요.
      const save = async (id: number | null, b = body): Promise<MemoRow> => {
        try {
          return await remote.saveMemo(id, b)
        } catch (e) {
          if (!isRejected(e, NO_SECTION) || b.sectionId === null) throw e
          ctx.notice(`'${memoTitle(b.title)}' 메모의 섹션이 지워져서 미분류에 넣었어요.`)
          return remote.saveMemo(id, { ...b, sectionId: null })
        }
      }
      const done = (row: MemoRow): Effect[] => { ctx.stamped(op.at, row.updatedAt); return [{ put: row }] }
      try {
        const id = r(op.id)
        if (id < 0) {
          const row = await save(null)
          ctx.map(op.id, row.id)
          return done(row)
        }
        const stamp = (await remote.memoStamps([id])).get(id)
        if (stamp === undefined) {
          const row = await save(null)
          ctx.map(id, row.id)
          ctx.replaced(id, row)
          ctx.notice(`'${row.title}' 메모는 다른 기기에서 지워져서, 이 기기에서 고친 내용으로 새로 만들었어요.`)
          return [...done(row), { remove: id }]
        }
        if (op.base && stamp !== ctx.stamp(op.base.updatedAt)) {
          const server = await remote.memo(id)
          const baseHtml = op.base.html === null ? null : resolveImages(op.base.html, r)
          if (server && (server.title !== op.base.title || server.contentHtml !== baseHtml)) {
            const copy = await save(null, { ...body, title: copyTitle(body.title) })
            ctx.replaced(id, copy)
            ctx.notice(`'${server.title}' 메모를 다른 기기에서도 고쳐서, 이 기기에서 고친 내용은 '${copy.title}'(으)로 따로 저장했어요.`)
            return [{ put: server }, ...done(copy)]
          }
        }
        return done(await save(id))
      } catch (e) {
        if (!isRejected(e)) throw e
        ctx.notice(`'${memoTitle(op.body.title)}' 메모를 서버에 저장하지 못했어요. ${(e as ApiError).message}`)
        return []
      }
    }
    case 'moveMemos': {
      if (!known(op.sectionId)) return []
      const stamps = await remote.memoStamps(op.ids.filter(known).map(r))
      const ids = [...stamps.keys()]
      if (!ids.length) return []
      try {
        await remote.moveMemos(ids, r(op.sectionId))
        return [{ apply: { ...op, ids } }]
      } catch (e) {
        if (!isRejected(e)) throw e
        ctx.notice(`메모를 옮기지 못했어요. ${(e as ApiError).message}`)
        return []
      }
    }
    case 'deleteMemos': {
      const wanted = op.ids.filter(known).map(r)
      const stamps = await remote.memoStamps(wanted)
      const ids = wanted.filter(id => stamps.has(id) && (op.bases[id] === undefined || stamps.get(id) === op.bases[id]))
      const kept = wanted.filter(id => stamps.has(id) && !ids.includes(id))
      if (kept.length) ctx.notice(`다른 기기에서 고친 메모 ${kept.length}개는 지우지 않고 남겨 뒀어요.`)
      if (ids.length) await remote.deleteMemos(ids)
      return [{ apply: { ...op, ids: wanted.filter(id => !kept.includes(id)) } }]
    }
    case 'restoreMemos':
    case 'purgeMemos':
    case 'pinMemos': {
      const ids = [...(await remote.memoStamps(op.ids.filter(known).map(r))).keys()]
      if (!ids.length) return []
      if (op.type === 'restoreMemos') await remote.restoreMemos(ids)
      else if (op.type === 'purgeMemos') await remote.purgeMemos(ids)
      else await remote.pinMemos(ids, op.pinned)
      return [{ apply: { ...op, ids } }]
    }
    case 'moveMemo': {
      if (!known(op.id) || (op.afterId !== null && !known(op.afterId)) || (op.beforeId !== null && !known(op.beforeId))) return []
      try {
        await remote.moveMemo(r(op.id), op.afterId === null ? null : r(op.afterId), op.beforeId === null ? null : r(op.beforeId))
        return [{ apply: op }]
      } catch (e) {
        if (!isRejected(e)) throw e
        return [] // 순서만 바뀌는 일이라, 그 사이 위아래 메모가 바뀌었으면 조용히 넘어가요.
      }
    }
  }
}

/** 보낸 결과를 서버 사본에 반영해요. */
export function applyEffects(snapshot: Data, effects: Effect[], r: Resolve): Data {
  const d = cloneData(snapshot)
  for (const e of effects) {
    if ('put' in e) d.memos.set(e.put.id, e.put)
    else if ('putSection' in e) d.sections.set(e.putSection.id, e.putSection)
    else if ('remove' in e) d.memos.delete(e.remove)
    else try { applyOp(d, e.apply, r) } catch { /* 다음 동기화가 맞춰요 */ }
  }
  return d
}
