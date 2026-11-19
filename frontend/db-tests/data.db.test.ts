import { describe, expect, it } from 'vitest'
import { fails, newUser, ok } from './helpers'

type Section = { id: number; parent_id: number | null; name: string; is_default: boolean; memo_count: number }

describe('섹션', () => {
  it('가입하면 미분류가 생기고, 미분류는 바꾸거나 지울 수 없다', async () => {
    const { db } = await newUser()
    const list = await ok<Section[]>(db.rpc('list_sections'))
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: '미분류', is_default: true, memo_count: 0 })
    const def = list[0].id
    expect(await fails(db.rpc('rename_section', { p_id: def, p_name: '다른 이름' }))).toContain('미분류')
    expect(await fails(db.rpc('delete_section', { p_id: def }))).toContain('미분류')
    expect(await fails(db.rpc('create_section', { p_name: '안', p_parent_id: def }))).toContain('미분류')
    // 표를 직접 고쳐도 막혀요.
    expect(await fails(db.from('sections').delete().eq('id', def))).toContain('미분류')
  })

  it('같은 위치에 같은 이름은 안 되고, 하위 섹션 안으로 옮길 수 없다', async () => {
    const { db } = await newUser()
    const a = await ok<Section>(db.rpc('create_section', { p_name: ' 회사 ', p_parent_id: null }))
    expect(a.name).toBe('회사')
    expect(await fails(db.rpc('create_section', { p_name: '회사', p_parent_id: null }))).toBe('같은 위치에 같은 이름의 섹션이 이미 있어요.')
    const b = await ok<Section>(db.rpc('create_section', { p_name: '회사', p_parent_id: a.id }))
    const c = await ok<Section>(db.rpc('create_section', { p_name: '일지', p_parent_id: b.id }))
    expect(await fails(db.rpc('move_section', { p_id: a.id, p_parent_id: c.id }))).toBe('자기 자신이나 하위 섹션 안으로는 옮길 수 없어요.')
    expect(await fails(db.from('sections').update({ parent_id: c.id }).eq('id', a.id))).toContain('하위 섹션')

    // 순서 바꾸기: c를 최상위 a 위로
    await ok(db.rpc('move_section', { p_id: c.id, p_parent_id: null, p_before_id: a.id }))
    const top = (await ok<Section[]>(db.rpc('list_sections'))).filter(s => s.parent_id === null).map(s => s.name)
    expect(top).toEqual(['미분류', '일지', '회사'])
  })

  it('섹션을 지우면 하위 섹션과 메모도 지워진다', async () => {
    const { db } = await newUser()
    const a = await ok<Section>(db.rpc('create_section', { p_name: 'A', p_parent_id: null }))
    const b = await ok<Section>(db.rpc('create_section', { p_name: 'B', p_parent_id: a.id }))
    await ok(db.rpc('save_memo', { p_id: null, p_section_id: b.id, p_title: '안', p_html: '<p>x</p>', p_text: 'x' }))
    await ok(db.rpc('delete_section', { p_id: a.id }))
    expect(await ok<Section[]>(db.rpc('list_sections'))).toHaveLength(1)
    expect(await ok<unknown[]>(db.from('memos').select('id'))).toHaveLength(0)
  })
})

type Memo = { id: number; title: string; title_sort: string; section_id: number; position: number }
type Page = { items: { id: number; title: string; preview: string }[]; total: number; totalCapped: boolean; hasNext: boolean }

describe('메모', () => {
  it('남의 메모와 섹션은 보이지도, 바뀌지도 않는다', async () => {
    const me = await newUser()
    const other = await newUser()
    const memo = await ok<Memo>(me.db.rpc('save_memo', { p_id: null, p_section_id: null, p_title: '비밀', p_html: null, p_text: '내용' }))

    expect(await ok<unknown[]>(other.db.from('memos').select('*'))).toHaveLength(0)
    expect(await ok<Section[]>(other.db.rpc('list_sections'))).toHaveLength(1)
    expect(await fails(other.db.rpc('save_memo', { p_id: memo.id, p_section_id: null, p_title: 'x', p_html: null, p_text: '' })))
      .toBe('메모를 찾을 수 없어요.')
    expect(await fails(other.db.rpc('delete_memos', { p_ids: [memo.id] }))).toBe('메모를 찾을 수 없어요.')
    // 남의 메모가 하나라도 섞이면 아무것도 지우지 않아요.
    const mine = await ok<Memo>(other.db.rpc('save_memo', { p_id: null, p_section_id: null, p_title: '내 것', p_html: null, p_text: '' }))
    expect(await fails(other.db.rpc('delete_memos', { p_ids: [mine.id, memo.id] }))).toBe('메모를 찾을 수 없어요.')
    expect(await ok<unknown[]>(other.db.from('memos').select('id'))).toHaveLength(1)
    // 직접 넣으면서 남의 user_id를 써도 막혀요.
    expect(await fails(other.db.from('memos').insert({ user_id: me.id, section_id: memo.section_id, title: 'x' }))).toBeTruthy()
    expect(await ok<unknown[]>(me.db.from('memos').select('id'))).toHaveLength(1)
  })

  it('제목이 비면 "제목 없음", 숫자는 크기 순서로 정렬된다', async () => {
    const { db } = await newUser()
    for (const title of ['업무 일지 22', '업무 일지 9', '', 'v1.10', 'v1.9']) {
      await ok(db.rpc('save_memo', { p_id: null, p_section_id: null, p_title: title, p_html: null, p_text: '' }))
    }
    const page = await ok<Page>(db.rpc('search_memos', { p_sort: 'TITLE_ASC' }))
    expect(page.items.map(m => m.title)).toEqual(['v1.9', 'v1.10', '업무 일지 9', '업무 일지 22', '제목 없음'])
  })

  it('검색: 모든 단어, 와일드카드 글자, 페이지와 건수', async () => {
    const { db } = await newUser()
    const save = (title: string, text: string) =>
      ok(db.rpc('save_memo', { p_id: null, p_section_id: null, p_title: title, p_html: null, p_text: text }))
    await save('회의록', '예산  100%\n확정')
    await save('회의', '예산 보류')
    await save('일지', '100_000')
    expect((await ok<Page>(db.rpc('search_memos', { p_q: '회의 예산' }))).total).toBe(2)
    expect((await ok<Page>(db.rpc('search_memos', { p_q: '100%' }))).items.map(m => m.title)).toEqual(['회의록'])
    expect((await ok<Page>(db.rpc('search_memos', { p_q: '_' }))).items.map(m => m.title)).toEqual(['일지'])
    const first = await ok<Page>(db.rpc('search_memos', { p_size: 2 }))
    expect(first).toMatchObject({ total: 3, hasNext: true, totalCapped: false })
    expect(first.items).toHaveLength(2)
    expect((await ok<Page>(db.rpc('search_memos', { p_q: '확정' }))).items[0].preview).toBe('예산 100% 확정')
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    expect((await ok<Page>(db.rpc('search_memos', { p_from: today, p_to: today }))).total).toBe(3)
    expect(await fails(db.rpc('search_memos', { p_from: '2026-02-01', p_to: '2026-01-01' }))).toBe('시작일이 종료일보다 늦어요.')
  })

  it('끌어서 순서를 바꾸고, 여러 개를 옮긴다', async () => {
    const { db } = await newUser()
    const ids: number[] = []
    for (const t of ['1', '2', '3']) {
      ids.push((await ok<Memo>(db.rpc('save_memo', { p_id: null, p_section_id: null, p_title: t, p_html: null, p_text: '' }))).id)
    }
    const order = async () => (await ok<Page>(db.rpc('search_memos', { p_sort: 'CUSTOM' }))).items.map(m => m.title)
    expect(await order()).toEqual(['3', '2', '1'])
    await ok(db.rpc('move_memo', { p_id: ids[0], p_after_id: ids[2], p_before_id: ids[1] }))
    expect(await order()).toEqual(['3', '1', '2'])
    await ok(db.rpc('move_memo', { p_id: ids[2], p_after_id: ids[1], p_before_id: null }))
    expect(await order()).toEqual(['1', '2', '3'])

    const s = await ok<Section>(db.rpc('create_section', { p_name: 'S', p_parent_id: null }))
    await ok(db.rpc('move_memos', { p_ids: ids.slice(0, 2), p_section_id: s.id }))
    expect((await ok<Page>(db.rpc('search_memos', { p_section_id: s.id }))).total).toBe(2)
  })
})
