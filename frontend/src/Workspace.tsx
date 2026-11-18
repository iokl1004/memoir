import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { api, ApiError, type MemoFilter, type MemoSort, type MemoSummary, type Section, type User } from './api'
import { useConfirm } from './confirm'
import MemoEditor from './MemoEditor'
import SectionOptions from './SectionOptions'
import {
  buildTree, moveTargets, subtreeIds, visibleNodes,
  type SectionNode, type SectionSort, type SectionSortKey,
} from './sectionTree'
import PaneResizer from './PaneResizer'
import ThemeToggle from './ThemeToggle'

type Selection = { kind: 'none' } | { kind: 'new' } | { kind: 'memo'; id: number }
type Period = 'all' | '7' | '30' | '90' | 'custom'

type Dir = 'ASC' | 'DESC'
type MemoSortField = 'TITLE' | 'UPDATED' | 'CREATED' | 'CUSTOM'

const MEMO_SORT_FIELDS: { value: MemoSortField; label: string }[] = [
  { value: 'TITLE', label: '이름' },
  { value: 'UPDATED', label: '수정한 날짜' },
  { value: 'CREATED', label: '만든 날짜' },
  { value: 'CUSTOM', label: '사용자 지정' },
]
const SECTION_SORT_FIELDS: { value: SectionSortKey; label: string }[] = [
  { value: 'NAME', label: '이름' },
  { value: 'CREATED', label: '만든 날짜' },
  { value: 'CUSTOM', label: '사용자 지정' },
]
const ALL_MEMO_SORTS: MemoSort[] = ['CREATED_DESC', 'CREATED_ASC', 'UPDATED_DESC', 'UPDATED_ASC', 'TITLE_ASC', 'TITLE_DESC', 'CUSTOM']

const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

/** 'CREATED_DESC' 같은 서버 정렬 값을 기준과 방향으로 나눠요. 사용자 지정은 방향이 없어요. */
function splitMemoSort(sort: MemoSort): { field: MemoSortField; dir: Dir } {
  if (sort === 'CUSTOM') return { field: 'CUSTOM', dir: 'ASC' }
  const [field, dir] = sort.split('_') as [MemoSortField, Dir]
  return { field, dir }
}

function joinMemoSort(field: MemoSortField, dir: Dir): MemoSort {
  return field === 'CUSTOM' ? 'CUSTOM' : (`${field}_${dir}` as MemoSort)
}

function savedSort(): MemoSort {
  const s = localStorage.getItem('memoir-sort')
  return ALL_MEMO_SORTS.includes(s as MemoSort) ? (s as MemoSort) : 'CREATED_DESC'
}

function savedSectionSort(): SectionSort {
  try {
    const s = JSON.parse(localStorage.getItem('memoir-section-sort') ?? '')
    if (SECTION_SORT_FIELDS.some(f => f.value === s.key) && (s.dir === 'ASC' || s.dir === 'DESC')) return s
  } catch { /* 저장된 값이 없거나 깨졌으면 기본값 */ }
  return { key: 'CUSTOM', dir: 'ASC' }
}

/** 섹션·메모 목록 칸의 넓이와 접힘. 브라우저에 저장해서 다음에도 그대로예요. */
type Layout = { navWidth: number; listWidth: number; navOpen: boolean; listOpen: boolean }
const DEFAULT_LAYOUT: Layout = { navWidth: 240, listWidth: 360, navOpen: true, listOpen: true }
const NAV_RANGE = { min: 180, max: 480 }
const LIST_RANGE = { min: 260, max: 640 }
/** 접힌 칸의 넓이(펼치기 버튼만 보여요) */
const RAIL = 44

function savedLayout(): Layout {
  try {
    const s = JSON.parse(localStorage.getItem('memoir-layout') ?? '')
    if (typeof s.navWidth === 'number' && typeof s.listWidth === 'number') return { ...DEFAULT_LAYOUT, ...s }
  } catch { /* 저장된 값이 없거나 깨졌으면 기본값 */ }
  return DEFAULT_LAYOUT
}

/** 정렬 기준과 방향 콤보박스 한 쌍. 사용자 지정이면 방향은 숨겨요. */
function SortPicker<F extends string>({ idPrefix, fields, field, dir, custom, onChange }: {
  idPrefix: string
  fields: { value: F; label: string }[]
  field: F
  dir: Dir
  custom: F
  onChange: (field: F, dir: Dir) => void
}) {
  return (
    <div className="sort-picker">
      <label className="sr-only" htmlFor={`${idPrefix}-field`}>정렬 기준</label>
      <select id={`${idPrefix}-field`} className="sort-picker__select" value={field}
              onChange={e => onChange(e.target.value as F, dir)}>
        {fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      {field !== custom && (
        <>
          <label className="sr-only" htmlFor={`${idPrefix}-dir`}>정렬 방향</label>
          <select id={`${idPrefix}-dir`} className="sort-picker__select" value={dir}
                  onChange={e => onChange(field, e.target.value as Dir)}>
            <option value="ASC">오름차순</option>
            <option value="DESC">내림차순</option>
          </select>
        </>
      )}
    </div>
  )
}

export default function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const confirm = useConfirm()
  const [sections, setSections] = useState<Section[]>([])
  const [filter, setFilter] = useState<MemoFilter>({})
  const [sort, setSort] = useState<MemoSort>(savedSort)
  const [memos, setMemos] = useState<MemoSummary[]>([])
  const [page, setPage] = useState({ number: 0, hasNext: false, total: 0, capped: false })
  // 첫 목록이 오기 전에 "메모가 없어요"가 잠깐 보이지 않게 해요.
  const [loaded, setLoaded] = useState(false)
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')
  const [sectionSort, setSectionSort] = useState<SectionSort>(savedSectionSort)
  const [layout, setLayout] = useState<Layout>(savedLayout)
  /** 목록에서 끌고 있는 메모들(고른 메모를 끌면 고른 것 전부). 사이드바 섹션이 받을 수 있는지 판단할 때 써요. */
  const [draggingMemos, setDraggingMemos] = useState<MemoSummary[] | null>(null)
  /** 여러 개 고른 메모 id. 하나라도 있으면 목록에 동그란 체크박스가 보여요. */
  const [checked, setChecked] = useState<Set<number>>(new Set())
  /** 열린 메모가 바깥에서 바뀌면(섹션 이동) 편집기를 다시 불러오려고 올려요. */
  const [editorVersion, setEditorVersion] = useState(0)

  const tree = useMemo(() => buildTree(sections, sectionSort), [sections, sectionSort])

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) onLogout()
    else setStatus(err instanceof ApiError ? err.message : '서버와 연결하지 못했어요.')
  }, [onLogout])

  const loadSections = useCallback(() => api.sections().then(setSections, fail), [fail])

  const loadMemos = useCallback((f: MemoFilter, s: MemoSort, pageNumber: number) =>
    api.memos(f, s, pageNumber).then(p => {
      setMemos(prev => (pageNumber === 0 ? p.items : [...prev, ...p.items]))
      setPage({ number: p.page, hasNext: p.hasNext, total: p.total, capped: p.totalCapped })
      setLoaded(true)
    }, fail), [fail])

  useEffect(() => { loadSections() }, [loadSections])
  useEffect(() => { loadMemos(filter, sort, 0) }, [filter, sort, loadMemos])

  /** 저장하지 않은 내용이 있으면 확인 창으로 물어보고, 떠나도 되면 true */
  async function confirmLeave(): Promise<boolean> {
    if (!dirty) return true
    return confirm({
      title: '저장하지 않은 내용이 있어요',
      body: '이동하면 지금 고친 내용이 사라져요.',
      confirmLabel: '저장하지 않고 이동',
      cancelLabel: '계속 고치기',
      danger: true,
    })
  }

  async function select(next: Selection) {
    if (!(await confirmLeave())) return
    setDirty(false)
    setSelection(next)
  }

  async function applyFilter(next: MemoFilter) {
    if (!(await confirmLeave())) return
    setDirty(false)
    setSelection({ kind: 'none' })
    setStatus('')
    setChecked(new Set())
    setFilter(next)
  }

  function changeSort(next: MemoSort) {
    localStorage.setItem('memoir-sort', next)
    setSort(next)
  }

  function changeLayout(patch: Partial<Layout>) {
    setLayout(prev => {
      const next = { ...prev, ...patch }
      localStorage.setItem('memoir-layout', JSON.stringify(next))
      return next
    })
  }

  function changeSectionSort(next: SectionSort) {
    localStorage.setItem('memoir-section-sort', JSON.stringify(next))
    setSectionSort(next)
  }

  function toggleChecked(id: number) {
    setChecked(prev => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  /** 메모들을 섹션으로 옮겨요. 이미 그 섹션에 있는 메모는 건너뛰어요. */
  async function moveMemosToSection(list: MemoSummary[], section: SectionNode) {
    const moving = list.filter(m => m.sectionId !== section.id)
    if (moving.length === 0) return
    const open = selection.kind === 'memo' && moving.some(m => m.id === selection.id)
    if (open && !(await confirmLeave())) return
    try {
      // shortcut: 메모마다 PATCH를 따로 보내요. 한 번에 수백 개를 옮기게 되면 일괄 API로 바꿔요.
      await Promise.all(moving.map(m => api.moveMemoToSection(m.id, section.id)))
      if (open) {
        setDirty(false)
        setEditorVersion(v => v + 1)
      }
      setStatus(moving.length === 1
        ? `'${moving[0].title}'을(를) '${section.path}'(으)로 옮겼어요.`
        : `메모 ${moving.length}개를 '${section.path}'(으)로 옮겼어요.`)
      setChecked(new Set())
    } catch (err) {
      fail(err)
    }
    refreshAfterChange()
  }

  function refreshAfterChange() {
    loadSections()
    loadMemos(filter, sort, 0)
  }

  async function logout() {
    if (!(await confirmLeave())) return
    await api.logout().catch(() => undefined)
    onLogout()
  }

  /** 메모 하나 또는 고른 메모 여럿을 확인한 뒤 지워요. */
  async function deleteMemos(list: MemoSummary[]) {
    if (list.length === 0) return
    const one = list.length === 1
    const ok = await confirm({
      title: one ? `'${list[0].title}' 메모를 지울까요?` : `메모 ${list.length}개를 지울까요?`,
      body: '지운 메모는 되살릴 수 없어요.',
      confirmLabel: one ? '메모 지우기' : `메모 ${list.length}개 지우기`,
      danger: true,
    })
    if (!ok) return
    try {
      // shortcut: 메모마다 DELETE를 따로 보내요. 한 번에 수백 개를 지우게 되면 일괄 API로 바꿔요.
      await Promise.all(list.map(m => api.deleteMemo(m.id)))
      if (selection.kind === 'memo' && list.some(m => m.id === selection.id)) {
        setDirty(false)
        setSelection({ kind: 'none' })
      }
      setStatus(one ? `'${list[0].title}' 메모를 지웠어요.` : `메모 ${list.length}개를 지웠어요.`)
      setChecked(new Set())
    } catch (err) {
      fail(err)
    }
    refreshAfterChange()
  }

  /** 사용자 지정 순서에서 index번째 메모를 to번째 자리로 옮겨요. 화면을 먼저 바꾸고, 실패하면 다시 불러와요. */
  async function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= memos.length) return
    const next = [...memos]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setMemos(next)
    try {
      await api.moveMemo(moved.id, next[to - 1]?.id ?? null, next[to + 1]?.id ?? null)
      setStatus(`'${moved.title}'을(를) ${to + 1}번째로 옮겼어요.`)
    } catch (err) {
      fail(err)
      loadMemos(filter, sort, 0)
    }
  }

  const defaultSection = sections.find(s => s.isDefault)
  const searching = !!(filter.q || filter.from || filter.to)
  const currentSection = tree.find(s => s.id === filter.sectionId)
  const listTitle = searching ? '검색 결과' : currentSection?.name ?? '전체 메모'
  const sectionPath = (id: number) => tree.find(s => s.id === id)?.path

  return (
    <div className="app" data-view={selection.kind === 'none' ? 'list' : 'editor'}
         style={{
           '--sidebar': `${layout.navOpen ? layout.navWidth : RAIL}px`,
           '--listw': `${layout.listOpen ? layout.listWidth : RAIL}px`,
         } as CSSProperties}>
      <header className="topbar">
        <p className="brand"><span className="brand__mark" aria-hidden="true">m</span> memoir</p>
        <SearchBar key={JSON.stringify([filter.q, filter.from, filter.to])} tree={tree} filter={filter}
                   onSearch={applyFilter} onOpenMemo={id => select({ kind: 'memo', id })} />
        <div className="topbar__user">
          <ThemeToggle />
          <span className="topbar__email">{user.email}</span>
          <button type="button" className="textbtn" onClick={logout}>로그아웃</button>
        </div>
      </header>

      <SectionNav
        tree={tree}
        sort={sectionSort}
        onSortChange={changeSectionSort}
        draggingMemos={draggingMemos}
        onMemosDrop={moveMemosToSection}
        activeId={filter.sectionId}
        onSelect={id => applyFilter({ ...filter, sectionId: id })}
        onChanged={refreshAfterChange}
        onDeleted={id => {
          // 지운 섹션과 하위 섹션, 그 안의 메모는 서버에서 모두 사라졌어요.
          const removed = subtreeIds(tree, id)
          const openMemo = selection.kind === 'memo' ? memos.find(m => m.id === selection.id) : undefined
          if (openMemo && removed.has(openMemo.sectionId)) {
            setDirty(false)
            setSelection({ kind: 'none' })
          }
          setChecked(new Set())
          loadSections()
          if (filter.sectionId !== undefined && removed.has(filter.sectionId)) setFilter({ ...filter, sectionId: undefined })
          else loadMemos(filter, sort, 0)
        }}
        onError={fail}
        paneCollapsed={!layout.navOpen}
        onPaneCollapsedChange={collapsed => changeLayout({ navOpen: !collapsed })}
      />
      {layout.navOpen && (
        <PaneResizer className="resizer--nav" label="섹션 칸 넓이" width={layout.navWidth} initial={DEFAULT_LAYOUT.navWidth}
                     {...NAV_RANGE} onChange={navWidth => changeLayout({ navWidth })} />
      )}

      <section className="list" aria-labelledby="list-title" data-collapsed={!layout.listOpen || undefined}>
        <button type="button" className="rail-toggle" aria-expanded="false" aria-controls="list-body"
                onClick={() => changeLayout({ listOpen: true })}>
          <span aria-hidden="true">»</span><span className="sr-only">메모 목록 펼치기</span>
        </button>
        <div id="list-body" className="pane-body">
        <div className="list__head">
          <h1 id="list-title" className="list__title">
            {listTitle}{' '}
            {loaded && (
              <span className="muted">
                {page.capped ? `${page.total.toLocaleString('ko-KR')}개 이상` : `${page.total.toLocaleString('ko-KR')}개`}
              </span>
            )}
          </h1>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => select({ kind: 'new' })}>
            새 메모 쓰기
          </button>
          <button type="button" className="collapse-btn" aria-expanded="true" aria-controls="list-body"
                  onClick={() => changeLayout({ listOpen: false })}>
            <span aria-hidden="true">«</span><span className="sr-only">메모 목록 접기</span>
          </button>
        </div>
        <div className="list__tools">
          <SortPicker idPrefix="memo-sort" fields={MEMO_SORT_FIELDS} custom="CUSTOM"
                      field={splitMemoSort(sort).field} dir={splitMemoSort(sort).dir}
                      onChange={(field, dir) => changeSort(joinMemoSort(field, dir))} />
          <span className="list__hint">
            {touchOnly
              ? '메모를 길게 누르면 여러 개를 고를 수 있어요.'
              : `${sort === 'CUSTOM' ? '끌거나 Alt + ↑↓ 로 순서를 바꾸고, 섹션에 놓으면 옮겨져요.' : '메모를 끌어 섹션에 놓으면 옮겨져요.'} Ctrl + 클릭으로 여러 개를 고르고, 우클릭으로 지워요.`}
          </span>
        </div>
        {searching && (
          <p className="list__filter">
            {describeFilter(filter, currentSection)}{' '}
            <button type="button" className="textbtn" onClick={() => applyFilter({ sectionId: filter.sectionId })}>
              검색 지우기
            </button>
          </p>
        )}
        <p className="status" role="status">{status}</p>

        {!loaded ? (
          <p className="list__empty" role="status">메모를 불러오는 중</p>
        ) : memos.length === 0 ? (
          <p className="list__empty">
            {searching ? '조건에 맞는 메모가 없어요. 단어를 줄이거나 기간을 넓혀 보세요.' : '아직 메모가 없어요. 첫 메모를 써 보세요.'}
          </p>
        ) : (
          <MemoList
            memos={memos}
            sort={sort}
            selectedId={selection.kind === 'memo' ? selection.id : null}
            sectionLabel={filter.sectionId === undefined ? sectionPath : undefined}
            onOpen={id => select({ kind: 'memo', id })}
            onDelete={deleteMemos}
            onClearChecked={() => setChecked(new Set())}
            onReorder={reorder}
            onDragMemos={setDraggingMemos}
            checked={checked}
            onToggle={toggleChecked}
          />
        )}
        {page.hasNext && (
          <button type="button" className="btn btn--secondary list__more"
                  onClick={() => loadMemos(filter, sort, page.number + 1)}>
            메모 더 보기
          </button>
        )}
        </div>
      </section>
      {layout.listOpen && (
        <PaneResizer className="resizer--list" label="메모 목록 칸 넓이" width={layout.listWidth} initial={DEFAULT_LAYOUT.listWidth}
                     {...LIST_RANGE} onChange={listWidth => changeLayout({ listWidth })} />
      )}

      <section className="pane" aria-label="메모 편집">
        {selection.kind === 'none' ? (
          <div className="pane__empty">
            <p>왼쪽 목록에서 메모를 고르거나 새 메모를 써 보세요.</p>
          </div>
        ) : (
          <MemoEditor
            key={selection.kind === 'memo' ? `${selection.id}-${editorVersion}` : 'new'}
            memoId={selection.kind === 'memo' ? selection.id : null}
            initialSectionId={filter.sectionId ?? defaultSection?.id}
            onDirtyChange={setDirty}
            onSaved={memo => { setDirty(false); setSelection({ kind: 'memo', id: memo.id }); refreshAfterChange() }}
            onDeleted={() => { setDirty(false); setSelection({ kind: 'none' }); refreshAfterChange() }}
            onClose={() => select({ kind: 'none' })}
            onError={fail}
          />
        )}
      </section>
    </div>
  )
}

function describeFilter(f: MemoFilter, section?: SectionNode): string {
  const parts = []
  if (f.q) parts.push(`"${f.q}"`)
  if (section) parts.push(`${section.path} 섹션`)
  if (f.from || f.to) parts.push(`${f.from ?? '처음'} ~ ${f.to ?? '오늘'}`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------- 메모 목록

// 터치 화면에서는 길게 누르기를 쓰려고 끌기를 꺼요(길게 누르면 브라우저가 끌기를 시작해요).
const touchOnly = window.matchMedia('(hover: none)').matches
const LONG_PRESS_MS = 500

function MemoList({ memos, sort, selectedId, sectionLabel, onOpen, onDelete, onReorder, onDragMemos, checked, onToggle, onClearChecked }: {
  memos: MemoSummary[]
  sort: MemoSort
  selectedId: number | null
  sectionLabel?: (sectionId: number) => string | undefined
  onOpen: (id: number) => void
  onDelete: (memos: MemoSummary[]) => void
  onReorder: (from: number, to: number) => void
  /** 메모를 끌기 시작하면 끄는 메모들, 끝나면 null. 사이드바 섹션에 놓을 수 있게 알려줘요. */
  onDragMemos: (memos: MemoSummary[] | null) => void
  checked: Set<number>
  onToggle: (id: number) => void
  onClearChecked: () => void
}) {
  const custom = sort === 'CUSTOM'
  const selecting = checked.size > 0
  const [menu, setMenu] = useState<{ x: number; y: number; group: MemoSummary[] } | null>(null)

  /** 고른 메모에서 시작하면 고른 것 전부, 아니면 그 메모 하나 */
  const groupOf = (m: MemoSummary) => (checked.has(m.id) ? memos.filter(x => checked.has(x.id)) : [m])
  const press = useRef<{ timer: number; fired: boolean } | null>(null)

  function startPress(e: PointerEvent<HTMLButtonElement>, id: number) {
    if (e.pointerType !== 'touch') return
    const p = { fired: false, timer: 0 }
    p.timer = window.setTimeout(() => { p.fired = true; onToggle(id); navigator.vibrate?.(20) }, LONG_PRESS_MS)
    press.current = p
  }

  function endPress() {
    if (press.current) window.clearTimeout(press.current.timer)
  }

  function onClick(e: MouseEvent<HTMLButtonElement>, id: number) {
    // 길게 눌러 고른 뒤 손을 떼면 click이 한 번 더 와요. 그건 무시해요.
    if (press.current?.fired) { press.current = null; return }
    if (e.ctrlKey || e.metaKey || selecting) onToggle(id)
    else onOpen(id)
  }
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null)
  const showUpdated = sort === 'UPDATED_DESC' || sort === 'UPDATED_ASC'

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === ' ' && selecting) {
      e.preventDefault()
      onToggle(memos[index].id)
    } else if (e.key === 'Escape' && selecting) {
      e.preventDefault()
      onClearChecked()
    } else if (e.key === 'Delete') {
      e.preventDefault()
      onDelete(groupOf(memos[index]))
    } else if (custom && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      onReorder(index, index + (e.key === 'ArrowUp' ? -1 : 1))
    }
  }

  function onDragOver(e: DragEvent<HTMLLIElement>, index: number) {
    // 목록 안에서 순서를 바꾸는 건 사용자 지정 순서일 때만이에요.
    if (dragIndex === null || !custom || checked.size > 1) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    setDrop({ index, after: e.clientY > rect.top + rect.height / 2 })
  }

  function onDrop(e: DragEvent<HTMLLIElement>) {
    e.preventDefault()
    if (dragIndex !== null && drop) {
      // 끌던 메모를 뺀 뒤의 목록에서 들어갈 자리
      let to = drop.index + (drop.after ? 1 : 0)
      if (dragIndex < to) to -= 1
      onReorder(dragIndex, to)
    }
    setDragIndex(null)
    setDrop(null)
  }

  return (
    <>
    <ul className="memo-list" data-custom={custom || undefined} data-selecting={selecting || undefined}>
      {memos.map((m, i) => (
        <li
          key={m.id}
          draggable={!touchOnly}
          data-dragging={dragIndex === i || (dragIndex !== null && checked.has(memos[dragIndex].id) && checked.has(m.id)) || undefined}
          data-drop={drop?.index === i ? (drop.after ? 'after' : 'before') : undefined}
          onDragStart={e => {
            // 고른 메모를 끌면 고른 것 전부, 아니면 그 메모 하나를 옮겨요.
            const group = groupOf(m)
            setDragIndex(i)
            onDragMemos(group)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', group.map(x => x.title).join('\n'))
          }}
          onDragOver={e => onDragOver(e, i)}
          onDragLeave={() => setDrop(d => (d?.index === i ? null : d))}
          onDrop={onDrop}
          onDragEnd={() => { setDragIndex(null); setDrop(null); onDragMemos(null) }}
        >
          <button
            type="button"
            className="memo-item"
            aria-current={selectedId === m.id ? 'true' : undefined}
            aria-pressed={selecting ? checked.has(m.id) : undefined}
            aria-keyshortcuts={custom ? 'Delete Alt+ArrowUp Alt+ArrowDown' : 'Delete'}
            onClick={e => onClick(e, m.id)}
            onKeyDown={e => onKeyDown(e, i)}
            onPointerDown={e => startPress(e, m.id)}
            onPointerUp={endPress}
            onPointerLeave={endPress}
            onPointerCancel={endPress}
            onContextMenu={e => {
              e.preventDefault()
              // 터치에서 길게 누르면 오는 contextmenu는 고르기에 쓰니 메뉴를 띄우지 않아요.
              if (touchOnly) return
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: e.clientX || r.left + 24, y: e.clientY || r.bottom, group: groupOf(m) })
            }}
          >
            {selecting && <span className="memo-item__check" data-checked={checked.has(m.id) || undefined} aria-hidden="true" />}
            {custom && <span className="memo-item__grip" aria-hidden="true">⋮⋮</span>}
            <span className="memo-item__title">{m.title}</span>
            {m.preview && <span className="memo-item__preview">{m.preview}</span>}
            <span className="memo-item__meta">
              {showUpdated ? '수정 ' : '작성 '}
              <time dateTime={showUpdated ? m.updatedAt : m.createdAt}>
                {dateFmt.format(new Date(showUpdated ? m.updatedAt : m.createdAt))}
              </time>
              {sectionLabel && <> · {sectionLabel(m.sectionId)}</>}
            </span>
          </button>
        </li>
      ))}
    </ul>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}
                     label={menu.group.length === 1 ? `'${menu.group[0].title}' 메모 메뉴` : `고른 메모 ${menu.group.length}개 메뉴`}
                     items={[{
                       label: menu.group.length === 1 ? '메모 지우기' : `고른 메모 ${menu.group.length}개 지우기`,
                       danger: true,
                       run: () => onDelete(menu.group),
                     }]} />
      )}
    </>
  )
}

// ---------------------------------------------------------------- 검색

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return toIso(d)
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 검색창 미리보기 한 번에 보여줄 개수 */
const SUGGEST_SIZE = 10

function SearchBar({ tree, filter, onSearch, onOpenMemo }: {
  tree: SectionNode[]
  filter: MemoFilter
  onSearch: (f: MemoFilter) => void
  onOpenMemo: (id: number) => void
}) {
  // 검색어가 바뀌면 부모가 key를 바꿔서 이 폼을 새로 만들어요. 그래서 초기값만 필터에서 가져와요.
  // 섹션 칸은 검색 중일 때만 필터를 따라요. 사이드바에서 섹션을 옮겨 다녀도 바뀌지 않아요.
  const searching = !!(filter.q || filter.from || filter.to)
  const [q, setQ] = useState(filter.q ?? '')
  const [sectionId, setSectionId] = useState(searching ? filter.sectionId : undefined)
  const [period, setPeriod] = useState<Period>(filter.from || filter.to ? 'custom' : 'all')
  const [from, setFrom] = useState(filter.from ?? '')
  const [to, setTo] = useState(filter.to ?? '')
  const [error, setError] = useState('')
  const [suggest, setSuggest] = useState<{ items: MemoSummary[]; total: number; capped: boolean; hasNext: boolean; page: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const formRef = useRef<HTMLFormElement>(null)

  /** 고른 기간을 날짜 범위로. 직접 고르기에서 시작일이 늦으면 null */
  function range(): Pick<MemoFilter, 'from' | 'to'> | null {
    if (period === 'custom') {
      if (from && to && from > to) return null
      return { from: from || undefined, to: to || undefined }
    }
    return period === 'all' ? {} : { from: isoDaysAgo(Number(period)), to: toIso(new Date()) }
  }

  // 입력을 멈추고 0.25초 뒤에 찾아요. 늦게 온 예전 응답은 버려요.
  const term = q.trim()
  const rangeKey = JSON.stringify(range())
  useEffect(() => {
    if (!term) return // 검색어가 없으면 미리보기를 그리지 않아요(shown 참고)
    let stale = false
    const timer = window.setTimeout(() => {
      api.memos({ q: term, sectionId, ...(JSON.parse(rangeKey) ?? {}) }, 'UPDATED_DESC', 0, SUGGEST_SIZE).then(p => {
        if (stale) return
        setSuggest({ items: p.items, total: p.total, capped: p.totalCapped, hasNext: p.hasNext, page: 0 })
        setActive(-1)
      }, () => { if (!stale) setSuggest(null) })
    }, 250)
    return () => { stale = true; window.clearTimeout(timer) }
  }, [term, sectionId, rangeKey])

  async function more() {
    if (!suggest) return
    const r = range() ?? {}
    const p = await api.memos({ q: term, sectionId, ...r }, 'UPDATED_DESC', suggest.page + 1, SUGGEST_SIZE).catch(() => null)
    if (!p) return
    setSuggest(s => s && { ...s, items: [...s.items, ...p.items], hasNext: p.hasNext, page: s.page + 1 })
  }

  function openMemo(id: number) {
    setOpen(false)
    onOpenMemo(id)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (open && suggest && active >= 0 && active < suggest.items.length) { openMemo(suggest.items[active].id); return }
    const r = range()
    if (!r) { setError('시작일이 종료일보다 늦어요.'); return }
    setError('')
    setOpen(false)
    onSearch({ sectionId, q: term || undefined, ...r })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!suggest?.items.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      const n = suggest.items.length
      setActive(i => (e.key === 'ArrowDown' ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1)))
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    }
  }

  const shown = open && !!term && suggest !== null
  const remaining = suggest ? (suggest.capped ? Infinity : suggest.total - suggest.items.length) : 0
  const moreCount = Math.min(SUGGEST_SIZE, remaining)
  const pathOf = (id: number) => tree.find(s => s.id === id)?.path

  return (
    <form className="search" role="search" onSubmit={submit} ref={formRef}
          onBlur={e => { if (!formRef.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <label className="sr-only" htmlFor="search-q">검색어</label>
      <input id="search-q" className="search__q" type="search" value={q} maxLength={100} autoComplete="off"
             placeholder="제목이나 본문에서 찾기"
             role="combobox" aria-expanded={shown} aria-controls={listId} aria-autocomplete="list"
             aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
             onChange={e => { setQ(e.target.value); setOpen(true) }}
             onFocus={() => setOpen(true)}
             onKeyDown={onKeyDown} />
      <label className="sr-only" htmlFor="search-section">섹션</label>
      <select id="search-section" value={sectionId ?? ''}
              onChange={e => setSectionId(e.target.value ? Number(e.target.value) : undefined)}>
        <option value="">모든 섹션</option>
        <SectionOptions tree={tree} />
      </select>
      <label className="sr-only" htmlFor="search-period">작성일</label>
      <select id="search-period" value={period} onChange={e => setPeriod(e.target.value as Period)}>
        <option value="all">모든 날짜</option>
        <option value="7">최근 1주</option>
        <option value="30">최근 1개월</option>
        <option value="90">최근 3개월</option>
        <option value="custom">날짜 직접 고르기</option>
      </select>
      {period === 'custom' && (
        <span className="search__dates">
          <label className="sr-only" htmlFor="search-from">시작일</label>
          <input id="search-from" type="date" value={from} onChange={e => setFrom(e.target.value)}
                 aria-invalid={!!error} aria-describedby={error ? 'search-error' : undefined} />
          <span aria-hidden="true">~</span>
          <label className="sr-only" htmlFor="search-to">종료일</label>
          <input id="search-to" type="date" value={to} onChange={e => setTo(e.target.value)} />
        </span>
      )}
      <button type="submit" className="btn btn--secondary btn--sm search__go">메모 찾기</button>
      {error && <p id="search-error" className="field__error search__error">{error}</p>}

      {shown && (
        <div className="suggest">
          {suggest.items.length === 0 ? (
            <p className="suggest__empty">'{term}'이(가) 들어간 메모가 없어요.</p>
          ) : (
            <>
              <p className="suggest__count">
                {suggest.capped ? `${suggest.total.toLocaleString('ko-KR')}건 이상` : `${suggest.total.toLocaleString('ko-KR')}건`}
                <span> · Enter로 전체 결과 보기</span>
              </p>
              <ul id={listId} className="suggest__list" role="listbox" aria-label="검색 결과 미리보기">
                {suggest.items.map((m, i) => (
                  <li key={m.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                      className="suggest__item"
                      onMouseDown={e => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => openMemo(m.id)}>
                    <span className="suggest__title">{m.title}</span>
                    {m.preview && <span className="suggest__preview">{m.preview}</span>}
                    <span className="suggest__meta">
                      {pathOf(m.sectionId)} · {dateFmt.format(new Date(m.updatedAt))}
                    </span>
                  </li>
                ))}
              </ul>
              {suggest.hasNext && moreCount > 0 && (
                <button type="button" className="suggest__more" onClick={more}>
                  {moreCount}건 더 보기
                </button>
              )}
            </>
          )}
        </div>
      )}
    </form>
  )
}

// ---------------------------------------------------------------- 섹션

type Editing =
  | { kind: 'add'; parentId: number | null }
  | { kind: 'rename'; id: number }
  | null
/** 끌어 놓을 곳: 섹션의 위(before)·아래(after)·안(into), 또는 'root'(최상위) */
type Place = 'before' | 'after' | 'into'
type DropTarget = { id: number; place: Place } | 'root' | null

function SectionNav({ tree, sort, onSortChange, draggingMemos, onMemosDrop, activeId, onSelect, onChanged, onDeleted, onError, paneCollapsed, onPaneCollapsedChange }: {
  tree: SectionNode[]
  sort: SectionSort
  onSortChange: (sort: SectionSort) => void
  /** 메모 목록에서 끌고 있는 메모들. 섹션에 놓으면 그 섹션으로 옮겨요. */
  draggingMemos: MemoSummary[] | null
  onMemosDrop: (memos: MemoSummary[], section: SectionNode) => void
  activeId?: number
  onSelect: (id?: number) => void
  onChanged: () => void
  onDeleted: (id: number) => void
  onError: (err: unknown) => void
  paneCollapsed: boolean
  onPaneCollapsedChange: (collapsed: boolean) => void
}) {
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Editing>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  /** 섹션을 우클릭(또는 메뉴 키)했을 때 띄우는 메뉴 */
  const [menu, setMenu] = useState<{ section: SectionNode; x: number; y: number } | null>(null)
  const total = tree.reduce((n, s) => n + s.memoCount, 0)
  const shown = visibleNodes(tree, collapsed)
  const targets = dragId === null ? [] : moveTargets(tree, dragId)
  const canDropOn = (target: number | 'root') =>
    targets.some(t => (target === 'root' ? t === null : t?.id === target))

  function toggle(id: number) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  /** 형제 순서대로(미분류 제외) 나열한 parentId의 하위 섹션 */
  function siblingsOf(parentId: number | null, except?: number) {
    return tree.filter(n => n.parentId === parentId && !n.isDefault && n.id !== except)
  }

  async function move(id: number, parentId: number | null, beforeId: number | null = null) {
    try {
      await api.moveSection(id, parentId, beforeId)
      if (parentId !== null) setCollapsed(prev => { const n = new Set(prev); n.delete(parentId); return n })
      setEditing(null)
      setError('')
      onChanged()
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) setError(err.message)
      else onError(err)
    }
  }

  /**
   * 섹션 위에서 끌고 있을 때 어디에 놓일지 정해요.
   * 사용자 지정 순서에서는 줄의 위쪽 ¼이면 그 섹션 위, 아래쪽 ¼이면 아래, 가운데면 안이에요.
   * 다른 정렬에서는 순서가 이름이나 날짜로 정해지니 "안"만 돼요.
   */
  function placeFor(e: DragEvent, s: SectionNode): Place | null {
    if (dragId === null) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    const blocked = subtreeIds(tree, dragId)
    const besideOk = sort.key === 'CUSTOM' && !s.isDefault && !blocked.has(s.id)
    if (besideOk && y < 0.25) return 'before'
    if (besideOk && y > 0.75) return 'after'
    if (canDropOn(s.id)) return 'into'
    return besideOk ? (y < 0.5 ? 'before' : 'after') : null
  }

  function rowDragOver(e: DragEvent, s: SectionNode) {
    if (draggingMemos) {
      if (draggingMemos.every(m => m.sectionId === s.id)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropTarget({ id: s.id, place: 'into' })
      return
    }
    const place = placeFor(e, s)
    if (!place) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget({ id: s.id, place })
  }

  function rowDrop(e: DragEvent, s: SectionNode) {
    e.preventDefault()
    if (draggingMemos) {
      onMemosDrop(draggingMemos, s)
    } else if (dragId !== null) {
      const place = placeFor(e, s)
      if (place === 'into') move(dragId, s.id)
      else if (place === 'before') move(dragId, s.parentId, s.id)
      else if (place === 'after') {
        const siblings = siblingsOf(s.parentId, dragId)
        move(dragId, s.parentId, siblings[siblings.findIndex(n => n.id === s.id) + 1]?.id ?? null)
      }
    }
    setDragId(null)
    setDropTarget(null)
  }

  function rootDragOver(e: DragEvent) {
    if (!canDropOn('root')) return
    e.preventDefault()
    setDropTarget('root')
  }

  function rootDrop(e: DragEvent) {
    e.preventDefault()
    if (dragId !== null && canDropOn('root')) move(dragId, null)
    setDragId(null)
    setDropTarget(null)
  }

  /** 사용자 지정 순서에서 Alt + ↑↓ 로 형제 사이 순서를 한 칸 바꿔요. */
  function nudge(s: SectionNode, up: boolean) {
    const siblings = siblingsOf(s.parentId)
    const i = siblings.findIndex(n => n.id === s.id)
    if (up && i > 0) move(s.id, s.parentId, siblings[i - 1].id)
    if (!up && i >= 0 && i < siblings.length - 1) move(s.id, s.parentId, siblings[i + 2]?.id ?? null)
  }

  async function save(name: string) {
    const trimmed = name.trim()
    if (!trimmed) { setError('섹션 이름을 적어 주세요.'); return }
    try {
      if (editing?.kind === 'add') {
        await api.createSection(trimmed, editing.parentId)
        if (editing.parentId !== null) setCollapsed(prev => { const n = new Set(prev); n.delete(editing.parentId!); return n })
      } else if (editing?.kind === 'rename') {
        await api.renameSection(editing.id, trimmed)
      }
      setEditing(null)
      setError('')
      onChanged()
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) setError(err.message)
      else onError(err)
    }
  }

  async function remove(section: SectionNode) {
    const parts = []
    if (section.descendantCount > 0) parts.push(`하위 섹션 ${section.descendantCount}개도 함께 지워져요.`)
    if (section.totalCount > 0) parts.push(`안의 메모 ${section.totalCount}개도 함께 지워지고, 되살릴 수 없어요.`)
    const ok = await confirm({
      title: `'${section.name}' 섹션을 지울까요?`,
      body: parts.join(' ') || '비어 있는 섹션이에요.',
      confirmLabel: '섹션 지우기',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteSection(section.id)
      onDeleted(section.id)
    } catch (err) {
      onError(err)
    }
  }

  function cancel() {
    setEditing(null)
    setError('')
  }

  return (
    <nav className="sections" aria-labelledby="sections-title" data-collapsed={paneCollapsed || undefined}>
      <button type="button" className="rail-toggle" aria-expanded="false" aria-controls="sections-body"
              onClick={() => onPaneCollapsedChange(false)}>
        <span aria-hidden="true">»</span><span className="sr-only">섹션 펼치기</span>
      </button>
      <div id="sections-body" className="pane-body">
      <div className="sections__head">
        <div className="sections__title-row">
          <h2 id="sections-title" className="sections__title">섹션</h2>
          <button type="button" className="collapse-btn" aria-expanded="true" aria-controls="sections-body"
                  onClick={() => onPaneCollapsedChange(true)}>
            <span aria-hidden="true">«</span><span className="sr-only">섹션 접기</span>
          </button>
        </div>
        <SortPicker idPrefix="section-sort" fields={SECTION_SORT_FIELDS} custom="CUSTOM"
                    field={sort.key} dir={sort.dir} onChange={(key, dir) => onSortChange({ key, dir })} />
      </div>
      <ul className="sections__list">
        <li>
          <button type="button" className="section-item" aria-current={activeId === undefined ? 'true' : undefined}
                  onClick={() => onSelect(undefined)}>
            <span>전체 메모</span><span className="section-item__count">{total}</span>
          </button>
        </li>
        {shown.map(s => (
          <li key={s.id} style={{ '--depth': s.depth } as CSSProperties}>
            {editing?.kind === 'rename' && editing.id === s.id ? (
              <NameInput label={`'${s.name}'의 새 이름`} initial={s.name} onSave={save} onCancel={cancel} />
            ) : (
              <div
                className="section-row"
                draggable={!s.isDefault}
                data-dragging={dragId === s.id || undefined}
                data-drop={dropTarget !== null && dropTarget !== 'root' && dropTarget.id === s.id ? dropTarget.place : undefined}
                onDragStart={e => {
                  setDragId(s.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', s.name)
                }}
                onDragOver={e => rowDragOver(e, s)}
                onDragLeave={() => setDropTarget(t => (t !== null && t !== 'root' && t.id === s.id ? null : t))}
                onDrop={e => rowDrop(e, s)}
                onDragEnd={() => { setDragId(null); setDropTarget(null) }}
                onContextMenu={e => {
                  // 미분류는 바꿀 수 없으니 브라우저 기본 메뉴를 그대로 둬요.
                  if (s.isDefault) return
                  e.preventDefault()
                  // 메뉴 키나 Shift+F10은 좌표가 0이라 줄 아래에 띄워요.
                  const r = e.currentTarget.getBoundingClientRect()
                  setMenu({ section: s, x: e.clientX || r.left + 24, y: e.clientY || r.bottom })
                }}
              >
                {s.childIds.length > 0 ? (
                  <button type="button" className="section-row__toggle" aria-expanded={!collapsed.has(s.id)}
                          aria-label={`${s.name} 하위 섹션 ${collapsed.has(s.id) ? '펼치기' : '접기'}`}
                          onClick={() => toggle(s.id)}>
                    <span aria-hidden="true">{collapsed.has(s.id) ? '▸' : '▾'}</span>
                  </button>
                ) : <span className="section-row__spacer" aria-hidden="true" />}
                <button type="button" className="section-item" aria-current={activeId === s.id ? 'true' : undefined}
                        aria-keyshortcuts={s.isDefault ? undefined : sort.key === 'CUSTOM' ? 'Delete Alt+ArrowUp Alt+ArrowDown' : 'Delete'}
                        onClick={() => onSelect(s.id)}
                        onKeyDown={e => {
                          if (s.isDefault) return
                          if (e.key === 'Delete') { e.preventDefault(); remove(s) }
                          if (sort.key === 'CUSTOM' && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                            e.preventDefault()
                            nudge(s, e.key === 'ArrowUp')
                          }
                        }}>
                  <span>{s.name}</span><span className="section-item__count">{s.memoCount}</span>
                </button>
              </div>
            )}
            {editing?.kind === 'add' && editing.parentId === s.id && (
              <div className="section-child-input">
                <NameInput label={`'${s.name}' 안에 만들 섹션 이름`} initial="" onSave={save} onCancel={cancel} />
              </div>
            )}
          </li>
        ))}
      </ul>

      {dragId !== null && canDropOn('root') && (
        <div className="sections__root-drop" data-drop={dropTarget === 'root' || undefined}
             onDragOver={rootDragOver}
             onDragLeave={() => setDropTarget(t => (t === 'root' ? null : t))}
             onDrop={rootDrop}>
          여기에 놓으면 최상위로 옮겨요
        </div>
      )}

      {editing?.kind === 'add' && editing.parentId === null ? (
        <NameInput label="새 섹션 이름" initial="" onSave={save} onCancel={cancel} />
      ) : (
        <button type="button" className="textbtn sections__add" onClick={() => { setEditing({ kind: 'add', parentId: null }); setError('') }}>
          + 섹션 추가
        </button>
      )}
      {error && <p className="field__error sections__error" role="alert">{error}</p>}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={`'${menu.section.name}' 섹션 메뉴`} onClose={() => setMenu(null)}
                     items={[
                       { label: '+ 하위 섹션', run: () => { setEditing({ kind: 'add', parentId: menu.section.id }); setError('') } },
                       { label: '이름 바꾸기', run: () => { setEditing({ kind: 'rename', id: menu.section.id }); setError('') } },
                       { label: '섹션 지우기', danger: true, run: () => remove(menu.section) },
                     ]} />
      )}
      </div>
    </nav>
  )
}

type MenuItem = { label: string; danger?: boolean; run: () => void }

/** 마우스 위치에 뜨는 작은 메뉴. 바깥을 누르거나 Esc, 스크롤하면 닫혀요. ↑↓로 고르고 Enter로 실행해요. */
function ContextMenu({ x, y, label, items, onClose }: {
  x: number
  y: number
  label: string
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Esc로 닫으면 메뉴를 연 섹션으로 포커스를 돌려줘요.
  const opener = useRef(document.activeElement as HTMLElement | null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current!
    // 화면 밖으로 나가지 않게 오른쪽·아래 끝에서 안쪽으로 당겨요.
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8)),
    })
    el.querySelector<HTMLButtonElement>('button')?.focus()
  }, [x, y])

  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const closeNow = () => onClose()
    document.addEventListener('pointerdown', close)
    window.addEventListener('scroll', closeNow, true)
    window.addEventListener('resize', closeNow)
    window.addEventListener('blur', closeNow)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', closeNow, true)
      window.removeEventListener('resize', closeNow)
      window.removeEventListener('blur', closeNow)
    }
  }, [onClose])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button')]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); opener.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus() }
  }

  // body 바로 아래에 그려요. 부모에 transform·translate(펼치기 애니메이션 등)가 있으면 fixed 위치가 그 부모 기준으로 바뀌어서요.
  return createPortal(
    <div ref={ref} className="ctx-menu" role="menu" aria-label={label} style={pos} onKeyDown={onKeyDown}
         onContextMenu={e => e.preventDefault()}>
      {items.map(item => (
        <button key={item.label} type="button" role="menuitem"
                className={item.danger ? 'ctx-menu__item ctx-menu__item--danger' : 'ctx-menu__item'}
                onClick={() => { onClose(); item.run() }}>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}

function NameInput({ label, initial, onSave, onCancel }: {
  label: string
  initial: string
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  const id = useId()
  return (
    <form className="name-input" onSubmit={e => { e.preventDefault(); onSave(name) }}>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <input id={id} autoFocus value={name} maxLength={30} placeholder="섹션 이름" onChange={e => setName(e.target.value)}
             onKeyDown={e => { if (e.key === 'Escape') onCancel() }} />
      <div className="name-input__actions">
        <button type="submit" className="btn btn--primary btn--sm">확인</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onCancel}>취소</button>
      </div>
    </form>
  )
}
