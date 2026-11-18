import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { api, ApiError, type MemoFilter, type MemoSort, type MemoSummary, type Section, type User } from './api'
import { useConfirm } from './confirm'
import MemoList from './MemoList'
import PaneResizer from './PaneResizer'
import SearchBar from './SearchBar'
import SectionNav from './SectionNav'
import SectionOptions from './SectionOptions'
import { buildTree, subtreeIds, type SectionNode, type SectionSort } from './sectionTree'
import { touchOnly, useMediaQuery } from './shared'
import SortPicker from './SortPicker'
import { joinMemoSort, MEMO_SORT_FIELDS, savedSectionSort, savedSort, splitMemoSort } from './sorting'
import ThemeToggle from './ThemeToggle'

// 편집기(TipTap)는 크니까 메모를 처음 열 때 불러와요. 첫 화면이 가벼워져요.
const MemoEditor = lazy(() => import('./MemoEditor'))

type Selection = { kind: 'none' } | { kind: 'new' } | { kind: 'memo'; id: number }

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
  /** 사이드바가 들어가는 좁은 화면(태블릿, 휴대폰)에서는 섹션을 왼쪽에서 밀려 나오는 서랍으로 보여줘요. */
  const narrow = useMediaQuery('(max-width: 1099px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawer = narrow && drawerOpen

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
  useEffect(() => {
    if (!drawer) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [drawer])
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
      await api.moveMemos(moving.map(m => m.id), section.id)
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
      await api.deleteMemos(list.map(m => m.id))
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
        onSelect={id => { setDrawerOpen(false); applyFilter({ ...filter, sectionId: id }) }}
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
        paneCollapsed={!narrow && !layout.navOpen}
        onPaneCollapsedChange={collapsed => (narrow ? setDrawerOpen(!collapsed) : changeLayout({ navOpen: !collapsed }))}
        drawer={drawer}
      />
      {drawer && <div className="drawer-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)} />}
      {layout.navOpen && (
        <PaneResizer className="resizer--nav" label="섹션 칸 넓이" width={layout.navWidth} initial={DEFAULT_LAYOUT.navWidth}
                     {...NAV_RANGE} onChange={navWidth => changeLayout({ navWidth })} />
      )}

      <section className="list" aria-labelledby="list-title" data-collapsed={!layout.listOpen || undefined}
               data-selecting={(touchOnly && checked.size > 0) || undefined}>
        <button type="button" className="rail-toggle" aria-expanded="false" aria-controls="list-body"
                onClick={() => changeLayout({ listOpen: true })}>
          <span aria-hidden="true">»</span><span className="sr-only">메모 목록 펼치기</span>
        </button>
        <div id="list-body" className="pane-body">
        <div className="list__head">
          <button type="button" className="btn btn--secondary btn--sm list__sections-btn" aria-expanded={drawer}
                  aria-controls="sections-body" onClick={() => setDrawerOpen(true)}>
            섹션
          </button>
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
      {touchOnly && checked.size > 0 && (
        // 휴대폰: 길게 눌러 고른 메모를 옮기거나 지우는 아래쪽 막대. (PC는 끌기와 우클릭을 써요)
        <div className="select-actions" role="toolbar" aria-label={`고른 메모 ${checked.size}개`}>
          <span className="select-actions__count">{checked.size}개 고름</span>
          <label className="sr-only" htmlFor="select-move">고른 메모를 옮길 섹션</label>
          <select id="select-move" className="select-actions__move" value=""
                  onChange={e => {
                    const target = tree.find(t => t.id === Number(e.target.value))
                    if (target) moveMemosToSection(memos.filter(m => checked.has(m.id)), target)
                  }}>
            <option value="" disabled>옮기기</option>
            <SectionOptions tree={tree} />
          </select>
          <button type="button" className="btn btn--secondary btn--sm select-actions__delete"
                  onClick={() => deleteMemos(memos.filter(m => checked.has(m.id)))}>
            지우기
          </button>
          <button type="button" className="textbtn" onClick={() => setChecked(new Set())}>취소</button>
        </div>
      )}
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
          <Suspense fallback={<p className="pane__loading" role="status">편집기를 불러오는 중</p>}>
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
          </Suspense>
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
