import { describe, expect, it } from 'vitest'
import {
  ApiError, applyOp, cloneData, flushOp, listSections, replay, searchMemos, titleSortKey, trashMemos,
  type Data, type FlushContext, type MemoRow, type Op, type Remote, type SectionRow,
} from './offline'

const T0 = '2026-11-20T01:00:00.000000+00:00'
const T1 = '2026-11-21T01:00:00.000000+00:00'
const sec = (id: number, name: string, extra: Partial<SectionRow> = {}): SectionRow =>
  ({ id, parentId: null, name, isDefault: false, position: id * 1024, createdAt: T0, ...extra })
const memo = (id: number, title: string, extra: Partial<MemoRow> = {}): MemoRow => ({
  id, sectionId: 1, title, content: title, contentHtml: `<p>${title}</p>`, createdAt: T0, updatedAt: T0, position: id * 1024, pinned: false, deletedAt: null, ...extra,
})
const data = (sections: SectionRow[], memos: MemoRow[]): Data =>
  ({ sections: new Map(sections.map(s => [s.id, s])), memos: new Map(memos.map(m => [m.id, m])) })
const base = () => data([sec(1, '미분류', { isDefault: true }), sec(2, '업무')], [memo(10, '회의'), memo(11, '장보기', { sectionId: 2 })])
const id = (x: number) => x
const body = (title: string, sectionId = 1) => ({ sectionId, title, contentHtml: `<p>${title}</p>`, content: title })

/** 서버 흉내: 메모 표와 섹션 표만 들고 있어요. */
function fakeServer(d: Data) {
  let next = 100
  const calls: string[] = []
  const remote: Remote = {
    createSection: async (name, parentId) => {
      if ([...d.sections.values()].some(s => s.parentId === parentId && s.name === name)) throw new ApiError(400, '같은 위치에 같은 이름의 섹션이 이미 있어요.')
      const row = sec(next++, name, { parentId }); d.sections.set(row.id, row); return row
    },
    renameSection: async () => undefined,
    deleteSection: async x => { if (!d.sections.delete(x)) throw new ApiError(400, '섹션을 찾을 수 없어요.') },
    moveSection: async () => undefined,
    sections: async () => [...d.sections.values()],
    saveMemo: async (x, b) => {
      const sectionId = b.sectionId ?? 1
      if (!d.sections.has(sectionId)) throw new ApiError(400, '섹션을 찾을 수 없어요.')
      calls.push(x === null ? `create ${b.title}` : `update ${x}`)
      const row = memo(x ?? next++, b.title, { sectionId, contentHtml: b.contentHtml, content: b.content, updatedAt: `2026-11-27T00:00:0${next % 10}Z` })
      d.memos.set(row.id, row)
      return row
    },
    memoStamps: async ids => new Map(ids.filter(x => d.memos.has(x)).map(x => [x, d.memos.get(x)!.updatedAt])),
    memo: async x => d.memos.get(x) ?? null,
    moveMemos: async () => undefined,
    deleteMemos: async ids => { calls.push(`delete ${ids.join(',')}`); ids.forEach(x => d.memos.delete(x)) },
    moveMemo: async () => undefined,
    restoreMemos: async ids => { calls.push(`restore ${ids.join(',')}`) },
    purgeMemos: async ids => { calls.push(`purge ${ids.join(',')}`) },
    pinMemos: async (ids, pinned) => { calls.push(`pin ${ids.join(',')} ${pinned}`) },
    uploadImage: async () => 777,
  }
  return { remote, calls, d }
}

function ctx() {
  const map = new Map<number, number>()
  const notices: string[] = []
  const replaced: number[] = []
  const c: FlushContext = {
    resolve: x => map.get(x) ?? x,
    map: (a, b) => { map.set(a, b) },
    stamp: x => x,
    stamped: () => undefined,
    image: async () => new Blob(['x']),
    notice: m => { notices.push(m) },
    replaced: (from, row) => { replaced.push(from, row.id) },
  }
  return { c, map, notices, replaced }
}

describe('이 기기에서 바로 반영', () => {
  it('섹션 규칙을 서버와 같은 문구로 지켜요', () => {
    const d = cloneData(base())
    expect(() => applyOp(d, { type: 'createSection', id: -1, name: '업무', parentId: null, at: T1 }, id)).toThrow('같은 이름')
    expect(() => applyOp(d, { type: 'createSection', id: -1, name: 'A', parentId: 1, at: T1 }, id)).toThrow('미분류 안에는')
    expect(() => applyOp(d, { type: 'deleteSection', id: 1 }, id)).toThrow('미분류')
    applyOp(d, { type: 'createSection', id: -1, name: '하위', parentId: 2, at: T1 }, id)
    expect(() => applyOp(d, { type: 'moveSection', id: 2, parentId: -1, beforeId: null }, id)).toThrow('하위 섹션 안으로는')
  })

  it('섹션을 지우면 하위 섹션도 지우고, 안의 메모는 미분류로 옮겨 휴지통에 넣어요', () => {
    const d = cloneData(base())
    applyOp(d, { type: 'createSection', id: -1, name: '하위', parentId: 2, at: T1 }, id)
    applyOp(d, { type: 'saveMemo', id: -2, body: body('새 메모', -1), base: null, at: T1 }, id)
    applyOp(d, { type: 'deleteSection', id: 2, at: T1 }, id)
    expect([...d.sections.keys()]).toEqual([1])
    expect(searchMemos(d, {}, 'CREATED_DESC', 0, 20).items.map(m => m.id)).toEqual([10])
    expect(trashMemos(d).map(m => [m.title, m.sectionId])).toEqual([['장보기', 1], ['새 메모', 1]])
    expect(listSections(d)[0].memoCount).toBe(1)
  })

  it('휴지통: 넣기, 되살리기, 완전히 지우기. 고치면 휴지통에서 나와요', () => {
    const d = cloneData(base())
    applyOp(d, { type: 'deleteMemos', ids: [10, 11], bases: {}, at: T1 }, id)
    expect(searchMemos(d, {}, 'CREATED_DESC', 0, 20).total).toBe(0)
    applyOp(d, { type: 'restoreMemos', ids: [10] }, id)
    applyOp(d, { type: 'purgeMemos', ids: [10, 11] }, id) // 10은 휴지통에 없어서 그대로
    expect([...d.memos.keys()]).toEqual([10])
    applyOp(d, { type: 'deleteMemos', ids: [10], bases: {}, at: T1 }, id)
    applyOp(d, { type: 'saveMemo', id: 10, body: body('회의록'), base: null, at: T1 }, id)
    expect(trashMemos(d)).toEqual([])
  })

  it('고정한 메모는 어떤 정렬에서도 맨 위예요', () => {
    const d = cloneData(base())
    applyOp(d, { type: 'pinMemos', ids: [11], pinned: true }, id)
    expect(searchMemos(d, {}, 'TITLE_DESC', 0, 20).items.map(m => m.id)).toEqual([11, 10])
    expect(searchMemos(d, {}, 'CUSTOM', 0, 20).items.map(m => m.id)).toEqual([11, 10])
  })

  it('다른 기기에서 섹션이 지워졌어도 쓴 메모는 미분류에 보여요', () => {
    const ops: Op[] = [{ type: 'saveMemo', id: -5, body: body('오프라인 메모', 2), base: null, at: T1 }]
    const server = base()
    server.sections.delete(2)
    expect(replay(server, ops, id).memos.get(-5)?.sectionId).toBe(1)
  })

  it('목록 순서와 메모 수, 검색과 날짜(한국 시간)', () => {
    const d = base()
    expect(listSections(d).map(s => [s.name, s.memoCount])).toEqual([['미분류', 1], ['업무', 1]])
    expect(searchMemos(d, { q: '회' }, 'CREATED_DESC', 0, 20).items.map(m => m.id)).toEqual([10])
    // T0은 한국 시간 11월 20일 10시예요.
    expect(searchMemos(d, { from: '2026-11-20', to: '2026-11-20' }, 'CREATED_DESC', 0, 20).total).toBe(2)
    expect(searchMemos(d, { from: '2026-11-21' }, 'CREATED_DESC', 0, 20).total).toBe(0)
    expect(titleSortKey('일지 9') < titleSortKey('일지 22')).toBe(true)
  })
})

describe('서버에 보내기', () => {
  it('새 섹션과 그 안의 새 메모: 임시 번호를 서버 번호로 바꿔 보내요', async () => {
    const { remote, d } = fakeServer(base())
    const { c, map } = ctx()
    await flushOp({ type: 'createSection', id: -1, name: '여행', parentId: null, at: T1 }, remote, c)
    await flushOp({ type: 'image', id: -3 }, remote, c)
    await flushOp({ type: 'saveMemo', id: -2, body: { ...body('일정', -1), contentHtml: '<img src="/img/-3">' }, base: null, at: T1 }, remote, c)
    const created = d.memos.get(map.get(-2)!)!
    expect(created.sectionId).toBe(map.get(-1))
    expect(created.contentHtml).toBe('<img src="/img/777">')
  })

  it('그 사이 아무도 안 고쳤으면 그대로 고쳐요', async () => {
    const { remote, calls } = fakeServer(base())
    const { c, notices } = ctx()
    await flushOp({ type: 'saveMemo', id: 10, body: body('회의록'), base: { updatedAt: T0, title: '회의', html: '<p>회의</p>' }, at: T1 }, remote, c)
    expect(calls).toEqual(['update 10'])
    expect(notices).toEqual([])
  })

  it('다른 기기에서 고쳤으면 둘 다 남겨요(내 것은 충돌 사본)', async () => {
    const server = base()
    server.memos.set(10, memo(10, '회의(다른 기기)', { updatedAt: T1 }))
    const { remote, calls, d } = fakeServer(server)
    const { c, notices, replaced } = ctx()
    const fx = await flushOp({ type: 'saveMemo', id: 10, body: body('회의(이 기기)'), base: { updatedAt: T0, title: '회의', html: '<p>회의</p>' }, at: T1 }, remote, c)
    expect(calls).toEqual(['create 회의(이 기기) (충돌 사본)'])
    expect(d.memos.get(10)!.title).toBe('회의(다른 기기)')
    expect(replaced[0]).toBe(10)
    expect(notices[0]).toContain('따로 저장')
    expect(fx).toHaveLength(2)
  })

  it('수정 시각만 바뀌고(섹션 옮기기) 내용이 같으면 충돌이 아니에요', async () => {
    const server = base()
    server.memos.set(10, memo(10, '회의', { updatedAt: T1, sectionId: 2 }))
    const { remote, calls } = fakeServer(server)
    await flushOp({ type: 'saveMemo', id: 10, body: body('회의록'), base: { updatedAt: T0, title: '회의', html: '<p>회의</p>' }, at: T1 }, remote, ctx().c)
    expect(calls).toEqual(['update 10'])
  })

  it('다른 기기에서 지운 메모를 고쳤으면 새 메모로 살려요', async () => {
    const server = base()
    server.memos.delete(10)
    const { remote, calls } = fakeServer(server)
    const { c, map, notices } = ctx()
    await flushOp({ type: 'saveMemo', id: 10, body: body('회의록'), base: { updatedAt: T0, title: '회의', html: '<p>회의</p>' }, at: T1 }, remote, c)
    expect(calls).toEqual(['create 회의록'])
    expect(map.get(10)).toBeGreaterThan(0)
    expect(notices[0]).toContain('새로 만들었어요')
  })

  it('섹션이 지워졌으면 미분류에 저장하고 알려요', async () => {
    const server = base()
    server.sections.delete(2)
    const { remote, d } = fakeServer(server)
    const { c, map, notices } = ctx()
    await flushOp({ type: 'saveMemo', id: -9, body: body('메모', 2), base: null, at: T1 }, remote, c)
    expect(d.memos.get(map.get(-9)!)!.sectionId).toBe(1)
    expect(notices[0]).toContain('미분류')
  })

  it('같은 이름 섹션이 이미 있으면 합쳐요', async () => {
    const { remote } = fakeServer(base())
    const { c, map } = ctx()
    await flushOp({ type: 'createSection', id: -1, name: '업무', parentId: null, at: T1 }, remote, c)
    expect(map.get(-1)).toBe(2)
  })

  it('지우기: 그 사이 다른 기기에서 고친 메모는 남겨요', async () => {
    const server = base()
    server.memos.set(11, memo(11, '장보기(고침)', { sectionId: 2, updatedAt: T1 }))
    const { remote, calls } = fakeServer(server)
    const { c, notices } = ctx()
    await flushOp({ type: 'deleteMemos', ids: [10, 11], bases: { 10: T0, 11: T0 } }, remote, c)
    expect(calls).toEqual(['delete 10'])
    expect(notices[0]).toContain('1개는 지우지 않고')
  })

  it('연결이 안 되면 오류를 던져 대기열에 남겨요', async () => {
    const { remote } = fakeServer(base())
    remote.memoStamps = async () => { throw new ApiError(500, '서버와 연결하지 못했어요.') }
    await expect(flushOp({ type: 'saveMemo', id: 10, body: body('x'), base: null, at: T1 }, remote, ctx().c)).rejects.toThrow('연결')
  })
})
