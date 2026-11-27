import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import AccountDialog from './AccountDialog'
import { api, ApiError, type MemoFilter, type MemoSort, type MemoSummary, type Section, type User } from './api'
import { useConfirm } from './confirm'
import MemoList from './MemoList'
import PaneResizer from './PaneResizer'
import SearchBar from './SearchBar'
import SectionNav from './SectionNav'
import SectionOptions from './SectionOptions'
import { buildTree, subtreeIds, type SectionNode, type SectionSort } from './sectionTree'
import { dateFmt, touchOnly, useMediaQuery } from './shared'
import SortPicker from './SortPicker'
import { onStore, resolve, store, useSyncStatus } from './store'
import { joinMemoSort, MEMO_SORT_FIELDS, savedSectionSort, savedSort, splitMemoSort } from './sorting'
import ThemeToggle from './ThemeToggle'

// 편집기(TipTap)는 크니까 메모를 처음 열 때 불러와요. 첫 화면이 가벼워져요.
const loadEditor = () => import('./MemoEditor')
const MemoEditor = lazy(loadEditor)

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
  /** 편집기를 새로 여는 번호. 다른 메모를 고르거나, 열린 메모가 바깥에서 바뀌면(섹션 이동) 올려요. */
  const [editorKey, setEditorKey] = useState(0)
  /** 이 기기의 저장소가 바뀔 때마다(내가 고침, 서버에서 받음, 다른 탭) 올려서 목록을 다시 읽어요. */
  const [rev, setRev] = useState(0)
  const sync = useSyncStatus()
  const [trashOpen, setTrashOpen] = useState(false)
  const [trash, setTrash] = useState<MemoSummary[]>([])
  /** 휴지통으로 옮긴 메모를 잠깐(3초) 알려주는 알림. 되돌리기를 누르면 되살려요. */
  const [toast, setToast] = useState<{ text: string; ids: number[] } | null>(null)
  /** 사용자가 직접 메모나 섹션을 골랐어요. 처음 화면을 자동으로 정하지 않아요. */
  const moved = useRef(false)
  /** 열린 편집기의 저장 함수 */
  const editorSave = useRef<(() => Promise<boolean>) | null>(null)
  /** 사이드바가 들어가는 좁은 화면(태블릿, 휴대폰)에서는 섹션을 왼쪽에서 밀려 나오는 서랍으로 보여줘요. */
  const narrow = useMediaQuery('(max-width: 1099px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const drawer = narrow && drawerOpen

  const tree = useMemo(() => buildTree(sections, sectionSort), [sections, sectionSort])

  /** 서버가 로그인을 거절했어요. 보내지 못한 변경이 없으면 이 기기에 남긴 메모도 지우고 나가요. */
  const expired = useCallback(() => {
    if (store.pending() === 0) void store.destroy()
    onLogout()
  }, [onLogout])

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) expired()
    else setStatus(err instanceof ApiError ? err.message : '서버와 연결하지 못했어요.')
  }, [expired])

  const loadSections = useCallback(() => store.sections().then(setSections, fail), [fail])

  /** keep이면 0쪽부터 pageNumber쪽까지 한 번에 다시 읽어요(더 보기로 펼친 목록이 줄어들지 않게). */
  const loadMemos = useCallback((f: MemoFilter, s: MemoSort, pageNumber: number, keep = false) =>
    store.memos(f, s, keep ? 0 : pageNumber, keep ? 20 * (pageNumber + 1) : 20).then(p => {
      setMemos(prev => (keep || pageNumber === 0 ? p.items : [...prev, ...p.items]))
      setPage({ number: pageNumber, hasNext: p.hasNext, total: p.total, capped: p.totalCapped })
      setLoaded(true)
    }, fail), [fail])

  // 저장소는 로그인한 동안 열어 둬요. 메모와 섹션은 이 기기에서 바로 읽고, 서버와는 뒤에서 맞춰요.
  useEffect(() => {
    void store.open(user)
    // 편집기도 미리 받아 둬요. 오프라인에서 처음 메모를 열 때도 편집기가 떠요.
    void loadEditor()
    return () => store.close()
  }, [user])
  useEffect(() => onStore('change', () => setRev(r => r + 1)), [])
  useEffect(() => onStore('notice', setStatus), [])
  useEffect(() => onStore('auth', expired), [expired])
  // 보낼 때 사본으로 저장했거나 새로 살린 메모로 고른 메모를 바꿔요. 편집기는 쓰던 내용 그대로예요.
  useEffect(() => onStore('replaced', ({ from, row }) => setSelection(sel =>
    sel.kind === 'memo' && resolve(sel.id) === resolve(from) ? { kind: 'memo', id: row.id } : sel)), [])

  useEffect(() => { loadSections() }, [loadSections, rev])
  useEffect(() => { store.trash().then(setTrash, fail) }, [rev, fail])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])
  // 들어오면 마지막으로 고친 메모를 그 섹션에서 열어요. 메모가 하나도 없으면 바로 새 메모를 써요.
  useEffect(() => {
    let cancelled = false
    store.memos({}, 'UPDATED_DESC', 0, 1).then(p => {
      if (cancelled || moved.current) return
      const latest = p.items[0]
      if (latest) setFilter({ sectionId: latest.sectionId })
      setEditorKey(k => k + 1)
      setSelection(latest ? { kind: 'memo', id: latest.id } : { kind: 'new' })
    }, () => undefined)
    return () => { cancelled = true }
  }, [user])
  // Ctrl + K(Mac은 ⌘ + K): 어디서든 검색창으로
  useEffect(() => {
    const focusSearch = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.getElementById('search-q')?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])
  useEffect(() => {
    if (!drawer) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [drawer])
  // 검색 조건이 바뀌면 첫 쪽부터, 저장소만 바뀌면 지금 펼친 만큼 다시 읽어요.
  const shown = useRef({ key: '', page: 0 })
  useEffect(() => { shown.current.page = page.number }, [page.number])
  useEffect(() => {
    const key = JSON.stringify([filter, sort])
    const same = shown.current.key === key
    shown.current.key = key
    loadMemos(filter, sort, same ? shown.current.page : 0, same)
  }, [filter, sort, rev, loadMemos])

  /** 저장하지 않은 내용이 있으면 확인 창으로 물어보고, 떠나도 되면 true */
  async function confirmLeave(): Promise<boolean> {
    moved.current = true
    if (!dirty) return true
    // 고치던 메모는 먼저 저장해요(자동 저장을 기다리지 않고). 저장할 수 없을 때만(글자 수 초과 등) 물어봐요.
    if (await editorSave.current?.()) return true
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
    if (next.kind !== 'none') setTrashOpen(false)
    const same = next.kind === selection.kind && (next.kind !== 'memo' || (selection.kind === 'memo' && resolve(selection.id) === resolve(next.id)))
    if (!same) setEditorKey(k => k + 1)
    setSelection(next)
  }

  async function applyFilter(next: MemoFilter): Promise<boolean> {
    if (!(await confirmLeave())) return false
    setDirty(false)
    setSelection({ kind: 'none' })
    setStatus('')
    setChecked(new Set())
    setTrashOpen(false)
    setFilter(next)
    return true
  }

  /** 섹션(또는 전체 메모)을 고르면 마지막으로 고친 메모를 열고, 메모가 없으면 바로 새 메모를 써요. */
  async function openSection(sectionId?: number) {
    setDrawerOpen(false)
    if (!(await applyFilter({ ...filter, sectionId }))) return
    const latest = (await store.memos({ sectionId }, 'UPDATED_DESC', 0, 1).catch(() => null))?.items[0]
    setEditorKey(k => k + 1)
    setSelection(latest ? { kind: 'memo', id: latest.id } : { kind: 'new' })
  }

  async function openTrash() {
    setDrawerOpen(false)
    if (!(await confirmLeave())) return
    setDirty(false)
    setSelection({ kind: 'none' })
    setStatus('')
    setChecked(new Set())
    setTrashOpen(true)
  }

  async function restore(list: MemoSummary[]) {
    try {
      await store.restoreMemos(list.map(m => m.id))
      setStatus(list.length === 1 ? `'${list[0].title}' 메모를 되살렸어요.` : `메모 ${list.length}개를 되살렸어요.`)
    } catch (err) {
      fail(err)
    }
  }

  /** 휴지통에서 완전히 지워요. 되돌릴 수 없어서 한 번 물어봐요. all: 휴지통 비우기 */
  async function purge(list: MemoSummary[], all = false) {
    if (list.length === 0) return
    const one = list.length === 1 && !all
    const ok = await confirm({
      title: one ? `'${list[0].title}' 메모를 완전히 지울까요?` : `휴지통의 메모 ${list.length}개를 모두 지울까요?`,
      body: '완전히 지운 메모는 되살릴 수 없어요.',
      confirmLabel: one ? '완전히 지우기' : '휴지통 비우기',
      danger: true,
    })
    if (!ok) return
    try {
      await store.purgeMemos(list.map(m => m.id))
      setStatus(one ? `'${list[0].title}' 메모를 완전히 지웠어요.` : '휴지통을 비웠어요.')
    } catch (err) {
      fail(err)
    }
  }

  async function pinMemos(list: MemoSummary[], pinned: boolean) {
    try {
      await store.pinMemos(list.map(m => m.id), pinned)
      const what = list.length === 1 ? `'${list[0].title}'` : `메모 ${list.length}개`
      setStatus(pinned ? `${what}을(를) 맨 위에 고정했어요.` : `${what}의 고정을 풀었어요.`)
      setChecked(new Set())
    } catch (err) {
      fail(err)
    }
  }

  /** 검색(미리보기, 결과 목록)에서 고른 메모: 그 메모의 섹션으로 옮겨 가서 목록에서도 고른 상태로 열어요. */
  async function openFromSearch(memo: MemoSummary) {
    if (!(await confirmLeave())) return
    setDirty(false)
    setStatus('')
    setChecked(new Set())
    setFilter({ sectionId: memo.sectionId })
    setEditorKey(k => k + 1)
    setSelection({ kind: 'memo', id: memo.id })
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
    const open = selection.kind === 'memo' && moving.some(m => m.id === resolve(selection.id))
    if (open && !(await confirmLeave())) return
    try {
      await store.moveMemos(moving.map(m => m.id), section.id)
      if (open) {
        setDirty(false)
        setEditorKey(k => k + 1)
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
    setRev(r => r + 1)
  }

  async function logout() {
    if (!(await confirmLeave())) return
    // 보내지 못한 변경이 있으면 먼저 보내 보고, 그래도 남으면(오프라인) 사라진다고 물어봐요.
    await store.sync().catch(() => undefined)
    const pending = store.pending()
    if (pending > 0 && !(await confirm({
      title: '서버에 보내지 못한 변경이 있어요',
      body: `이 기기에만 있는 변경 ${pending}개가 로그아웃하면 사라져요. 인터넷에 연결한 뒤 로그아웃하면 모두 서버에 저장돼요.`,
      confirmLabel: '그래도 로그아웃',
      cancelLabel: '로그인 유지',
      danger: true,
    }))) return
    // 로그아웃하면 이 기기에 남긴 메모와 그림도 지워요(함께 쓰는 PC).
    await store.destroy()
    await api.logout().catch(() => undefined)
    onLogout()
  }

  /** 메모 하나 또는 고른 메모 여럿을 확인한 뒤 지워요. */
  /** 휴지통으로 옮겨요. 30일 안에 되살릴 수 있어서 묻지 않아요. */
  async function deleteMemos(list: MemoSummary[]) {
    if (list.length === 0) return
    try {
      await store.deleteMemos(list.map(m => m.id))
      afterTrash(list)
    } catch (err) {
      fail(err)
    }
  }

  /** 휴지통으로 옮긴 뒤: 무엇을 옮겼는지 잠깐 보여주고, 열려 있던 메모였으면 목록에서 그다음 메모를 열어요. */
  function afterTrash(list: { id: number; title: string }[]) {
    const gone = new Set(list.map(m => resolve(m.id)))
    if (selection.kind === 'memo' && gone.has(resolve(selection.id))) {
      const i = memos.findIndex(m => m.id === resolve(selection.id))
      const rest = memos.filter(m => !gone.has(m.id))
      // 바로 아래 메모, 맨 아래였으면 바로 위 메모
      const next = i < 0 ? undefined : rest[Math.min(i, rest.length - 1)]
      setDirty(false)
      setEditorKey(k => k + 1)
      setSelection(next ? { kind: 'memo', id: next.id } : { kind: 'none' })
    }
    setChecked(new Set())
    setToast({
      text: list.length === 1 ? `'${list[0].title}' 메모를 휴지통으로 옮겼어요.` : `메모 ${list.length}개를 휴지통으로 옮겼어요.`,
      ids: list.map(m => m.id),
    })
  }

  /** 사용자 지정 순서에서 index번째 메모를 to번째 자리로 옮겨요. 화면을 먼저 바꾸고, 실패하면 다시 불러와요. */
  async function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= memos.length) return
    const next = [...memos]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setMemos(next)
    try {
      await store.moveMemo(moved.id, next[to - 1]?.id ?? null, next[to + 1]?.id ?? null)
      setStatus(`'${moved.title}'을(를) ${to + 1}번째로 옮겼어요.`)
    } catch (err) {
      fail(err)
      loadMemos(filter, sort, 0)
    }
  }

  const defaultSection = sections.find(s => s.isDefault)
  const searching = !!(filter.q || filter.from || filter.to)
  const activeSectionId = filter.sectionId === undefined ? undefined : resolve(filter.sectionId)
  const currentSection = tree.find(s => s.id === activeSectionId)
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
                   onSearch={applyFilter} onOpenMemo={openFromSearch} />
        <div className="topbar__user">
          {/* 인터넷이 없거나 서버에 보낼 변경이 남았을 때만 보여요. 다 보내면 비어요. */}
          <span className="sync" role="status" data-offline={sync.offline || undefined}
                title={sync.offline ? '이 기기에 저장해 두고, 인터넷에 연결되면 서버에 보내요.' : undefined}>
            {sync.offline
              ? sync.pending > 0 ? `오프라인 · 보낼 변경 ${sync.pending}개` : '오프라인'
              : sync.pending > 0 ? `보내는 중 · ${sync.pending}개` : ''}
          </span>
          <ThemeToggle />
          <span className="topbar__email">{user.email}</span>
          <button type="button" className="textbtn" onClick={() => setAccountOpen(true)}>계정</button>
          <button type="button" className="textbtn" onClick={logout}>로그아웃</button>
        </div>
      </header>

      <SectionNav
        tree={tree}
        sort={sectionSort}
        onSortChange={changeSectionSort}
        draggingMemos={draggingMemos}
        onMemosDrop={moveMemosToSection}
        activeId={activeSectionId}
        onSelect={openSection}
        trashCount={trash.length}
        trashOpen={trashOpen}
        onOpenTrash={openTrash}
        onChanged={refreshAfterChange}
        onDeleted={id => {
          // 지운 섹션과 하위 섹션, 그 안의 메모는 서버에서 모두 사라졌어요.
          const removed = subtreeIds(tree, id)
          const openMemo = selection.kind === 'memo' ? memos.find(m => m.id === resolve(selection.id)) : undefined
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
            {trashOpen ? '휴지통' : listTitle}{' '}
            {trashOpen ? <span className="muted">{trash.length.toLocaleString('ko-KR')}개</span> : loaded && (
              <span className="muted">
                {page.capped ? `${page.total.toLocaleString('ko-KR')}개 이상` : `${page.total.toLocaleString('ko-KR')}개`}
              </span>
            )}
          </h1>
          {/* 휴지통에서는 쓰지 않아요. */}
          {!trashOpen && (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => select({ kind: 'new' })}>
              새 메모 쓰기
            </button>
          )}
          <button type="button" className="collapse-btn" aria-expanded="true" aria-controls="list-body"
                  onClick={() => changeLayout({ listOpen: false })}>
            <span aria-hidden="true">«</span><span className="sr-only">메모 목록 접기</span>
          </button>
        </div>
        {trashOpen ? <>
          <p className="list__trash-note">지운 메모는 30일 동안 여기 있다가 완전히 지워져요.</p>
          <p className="status" role="status">{status}</p>
          {trash.length === 0 ? (
            <p className="list__empty">휴지통이 비어 있어요.</p>
          ) : <>
            <ul className="trash-list" aria-label="휴지통의 메모">
              {trash.map(m => (
                <li key={m.id} className="trash-item">
                  <div>
                    <p className="trash-item__title">{m.title}</p>
                    <p className="trash-item__meta">
                      {dateFmt.format(new Date(m.deletedAt!))}에 지움{m.preview && ` · ${m.preview}`}
                    </p>
                  </div>
                  <div className="trash-item__actions">
                    <button type="button" className="textbtn" onClick={() => restore([m])}>되살리기</button>
                    <button type="button" className="textbtn textbtn--danger" onClick={() => purge([m])}>완전히 지우기</button>
                  </div>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn--secondary list__more" onClick={() => purge(trash, true)}>휴지통 비우기</button>
          </>}
        </> : <>
        <div className="list__tools">
          <SortPicker idPrefix="memo-sort" fields={MEMO_SORT_FIELDS} custom="CUSTOM"
                      field={splitMemoSort(sort).field} dir={splitMemoSort(sort).dir}
                      onChange={(field, dir) => changeSort(joinMemoSort(field, dir))} />
          <span className="list__hint">
            {touchOnly
              ? '메모를 길게 누르면 여러 개를 고를 수 있어요.'
              : `${sort === 'CUSTOM' ? '끌거나 Alt + ↑↓ 로 순서를 바꾸고, 섹션에 놓으면 옮겨져요.' : '메모를 끌어 섹션에 놓으면 옮겨져요.'} Ctrl + 클릭으로 여러 개를 고르고, 우클릭으로 고정하거나 휴지통으로 옮겨요.`}
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
            selectedId={selection.kind === 'memo' ? resolve(selection.id) : null}
            sectionLabel={filter.sectionId === undefined ? sectionPath : undefined}
            onOpen={id => {
              // 검색 결과에서 연 메모는 미리보기처럼 그 메모의 섹션으로 옮겨 가요.
              const memo = searching ? memos.find(m => m.id === id) : undefined
              if (memo) openFromSearch(memo)
              else select({ kind: 'memo', id })
            }}
            onDelete={deleteMemos}
            onPin={pinMemos}
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
        {loaded && (
          <button type="button" className="list__new" onClick={() => select({ kind: 'new' })}>
            <span aria-hidden="true">+</span><span className="sr-only">새 메모 쓰기</span>
          </button>
        )}
        </>}
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
          <button type="button" className="btn btn--secondary btn--sm"
                  onClick={() => {
                    const list = memos.filter(m => checked.has(m.id))
                    pinMemos(list, !list.every(m => m.pinned))
                  }}>
            {memos.filter(m => checked.has(m.id)).every(m => m.pinned) ? '고정 풀기' : '고정'}
          </button>
          <button type="button" className="btn btn--secondary btn--sm select-actions__delete"
                  onClick={() => deleteMemos(memos.filter(m => checked.has(m.id)))}>
            휴지통으로
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
            key={editorKey}
            memoId={selection.kind === 'memo' ? selection.id : null}
            initialSectionId={filter.sectionId ?? defaultSection?.id}
            onDirtyChange={setDirty}
            onSaved={memo => { setDirty(false); setSelection({ kind: 'memo', id: memo.id }); refreshAfterChange() }}
            saveRef={editorSave}
            onDeleted={memo => afterTrash([memo])}
            onClose={() => select({ kind: 'none' })}
            onError={fail}
          />
          </Suspense>
        )}
      </section>
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast">
            <span>{toast.text}</span>
            <button type="button" className="textbtn toast__undo"
                    onClick={() => { const ids = toast.ids; setToast(null); store.restoreMemos(ids).catch(fail) }}>
              되돌리기
            </button>
          </div>
        )}
      </div>
      {accountOpen && (
        <AccountDialog user={user} onClose={() => setAccountOpen(false)} onDeleted={onLogout} />
      )}
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
