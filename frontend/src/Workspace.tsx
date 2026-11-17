import {
  useCallback, useEffect, useId, useMemo, useState,
  type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent,
} from 'react'
import { api, ApiError, type MemoFilter, type MemoSort, type MemoSummary, type Section, type User } from './api'
import { useConfirm } from './confirm'
import MemoEditor from './MemoEditor'
import SectionOptions from './SectionOptions'
import { buildTree, visibleNodes, type SectionNode } from './sectionTree'
import ThemeToggle from './ThemeToggle'

type Selection = { kind: 'none' } | { kind: 'new' } | { kind: 'memo'; id: number }
type Period = 'all' | '7' | '30' | '90' | 'custom'

const SORTS: { value: MemoSort; label: string }[] = [
  { value: 'CREATED_DESC', label: '최근 만든 순' },
  { value: 'CREATED_ASC', label: '오래전에 만든 순' },
  { value: 'UPDATED_DESC', label: '최근 수정한 순' },
  { value: 'UPDATED_ASC', label: '오래전에 수정한 순' },
  { value: 'TITLE_ASC', label: '제목 가나다순' },
  { value: 'TITLE_DESC', label: '제목 가나다 역순' },
  { value: 'CUSTOM', label: '직접 정한 순서' },
]

const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

function savedSort(): MemoSort {
  const s = localStorage.getItem('memoir-sort')
  return SORTS.some(o => o.value === s) ? (s as MemoSort) : 'CREATED_DESC'
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

  const tree = useMemo(() => buildTree(sections), [sections])

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
    setFilter(next)
  }

  function changeSort(next: MemoSort) {
    localStorage.setItem('memoir-sort', next)
    setSort(next)
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

  async function deleteMemo(memo: MemoSummary) {
    const ok = await confirm({
      title: `'${memo.title}' 메모를 지울까요?`,
      body: '지운 메모는 되살릴 수 없어요.',
      confirmLabel: '메모 지우기',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteMemo(memo.id)
      if (selection.kind === 'memo' && selection.id === memo.id) {
        setDirty(false)
        setSelection({ kind: 'none' })
      }
      setStatus(`'${memo.title}' 메모를 지웠어요.`)
      refreshAfterChange()
    } catch (err) {
      fail(err)
    }
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
    <div className="app" data-view={selection.kind === 'none' ? 'list' : 'editor'}>
      <header className="topbar">
        <p className="brand"><span className="brand__mark" aria-hidden="true">m</span> memoir</p>
        <SearchBar key={JSON.stringify(filter)} tree={tree} filter={filter} onSearch={applyFilter} />
        <div className="topbar__user">
          <ThemeToggle />
          <span className="topbar__email">{user.email}</span>
          <button type="button" className="textbtn" onClick={logout}>로그아웃</button>
        </div>
      </header>

      <SectionNav
        tree={tree}
        activeId={filter.sectionId}
        onSelect={id => applyFilter({ ...filter, sectionId: id })}
        onChanged={refreshAfterChange}
        onDeleted={id => {
          const removed = tree.find(s => s.id === id)
          const gone = filter.sectionId === id || (removed && currentSection?.path.startsWith(`${removed.path} › `))
          if (gone) applyFilter({ ...filter, sectionId: undefined })
          else refreshAfterChange()
        }}
        onError={fail}
      />

      <section className="list" aria-labelledby="list-title">
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
        </div>
        <div className="list__tools">
          <label className="sr-only" htmlFor="memo-sort">정렬</label>
          <select id="memo-sort" className="list__sort" value={sort} onChange={e => changeSort(e.target.value as MemoSort)}>
            {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {sort === 'CUSTOM' && <span className="list__hint">끌거나 Alt + ↑↓ 로 순서를 바꿔요</span>}
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
            sectionLabel={filter.sectionId === undefined || (currentSection?.descendantCount ?? 0) > 0 ? sectionPath : undefined}
            onOpen={id => select({ kind: 'memo', id })}
            onDelete={deleteMemo}
            onReorder={reorder}
          />
        )}
        {page.hasNext && (
          <button type="button" className="btn btn--secondary list__more"
                  onClick={() => loadMemos(filter, sort, page.number + 1)}>
            메모 더 보기
          </button>
        )}
      </section>

      <section className="pane" aria-label="메모 편집">
        {selection.kind === 'none' ? (
          <div className="pane__empty">
            <p>왼쪽 목록에서 메모를 고르거나 새 메모를 써 보세요.</p>
          </div>
        ) : (
          <MemoEditor
            key={selection.kind === 'memo' ? selection.id : 'new'}
            memoId={selection.kind === 'memo' ? selection.id : null}
            tree={tree}
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

function MemoList({ memos, sort, selectedId, sectionLabel, onOpen, onDelete, onReorder }: {
  memos: MemoSummary[]
  sort: MemoSort
  selectedId: number | null
  sectionLabel?: (sectionId: number) => string | undefined
  onOpen: (id: number) => void
  onDelete: (memo: MemoSummary) => void
  onReorder: (from: number, to: number) => void
}) {
  const custom = sort === 'CUSTOM'
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null)
  const showUpdated = sort === 'UPDATED_DESC' || sort === 'UPDATED_ASC'

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === 'Delete') {
      e.preventDefault()
      onDelete(memos[index])
    } else if (custom && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      onReorder(index, index + (e.key === 'ArrowUp' ? -1 : 1))
    }
  }

  function onDragOver(e: DragEvent<HTMLLIElement>, index: number) {
    if (dragIndex === null) return
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
    <ul className="memo-list" data-custom={custom || undefined}>
      {memos.map((m, i) => (
        <li
          key={m.id}
          draggable={custom}
          data-dragging={dragIndex === i || undefined}
          data-drop={drop?.index === i ? (drop.after ? 'after' : 'before') : undefined}
          onDragStart={e => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(m.id)) }}
          onDragOver={e => onDragOver(e, i)}
          onDragLeave={() => setDrop(d => (d?.index === i ? null : d))}
          onDrop={onDrop}
          onDragEnd={() => { setDragIndex(null); setDrop(null) }}
        >
          <button
            type="button"
            className="memo-item"
            aria-current={selectedId === m.id ? 'true' : undefined}
            aria-keyshortcuts={custom ? 'Delete Alt+ArrowUp Alt+ArrowDown' : 'Delete'}
            onClick={() => onOpen(m.id)}
            onKeyDown={e => onKeyDown(e, i)}
          >
            {custom && <span className="memo-item__grip" aria-hidden="true">⋮⋮</span>}
            <span className="memo-item__title">{m.title}</span>
            {m.preview && <span className="memo-item__preview">{m.preview}</span>}
            <span className="memo-item__meta">
              {showUpdated ? '수정 ' : ''}
              <time dateTime={showUpdated ? m.updatedAt : m.createdAt}>
                {dateFmt.format(new Date(showUpdated ? m.updatedAt : m.createdAt))}
              </time>
              {sectionLabel && <> · {sectionLabel(m.sectionId)}</>}
            </span>
          </button>
        </li>
      ))}
    </ul>
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

function SearchBar({ tree, filter, onSearch }: {
  tree: SectionNode[]
  filter: MemoFilter
  onSearch: (f: MemoFilter) => void
}) {
  // 필터가 바뀌면 부모가 key를 바꿔서 이 폼을 새로 만들어요. 그래서 초기값만 필터에서 가져와요.
  const [q, setQ] = useState(filter.q ?? '')
  const [sectionId, setSectionId] = useState(filter.sectionId)
  const [period, setPeriod] = useState<Period>(filter.from || filter.to ? 'custom' : 'all')
  const [from, setFrom] = useState(filter.from ?? '')
  const [to, setTo] = useState(filter.to ?? '')
  const [error, setError] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    let range: Pick<MemoFilter, 'from' | 'to'> = {}
    if (period === 'custom') {
      if (from && to && from > to) { setError('시작일이 종료일보다 늦어요.'); return }
      range = { from: from || undefined, to: to || undefined }
    } else if (period !== 'all') {
      range = { from: isoDaysAgo(Number(period)), to: toIso(new Date()) }
    }
    setError('')
    onSearch({ sectionId, q: q.trim() || undefined, ...range })
  }

  return (
    <form className="search" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor="search-q">검색어</label>
      <input id="search-q" className="search__q" type="search" value={q} maxLength={100}
             placeholder="제목이나 본문에서 찾기" onChange={e => setQ(e.target.value)} />
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
    </form>
  )
}

// ---------------------------------------------------------------- 섹션

type Editing = { kind: 'add'; parentId: number | null } | { kind: 'rename'; id: number } | null

function SectionNav({ tree, activeId, onSelect, onChanged, onDeleted, onError }: {
  tree: SectionNode[]
  activeId?: number
  onSelect: (id?: number) => void
  onChanged: () => void
  onDeleted: (id: number) => void
  onError: (err: unknown) => void
}) {
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Editing>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const total = tree.filter(s => s.depth === 0).reduce((n, s) => n + s.totalCount, 0)
  const active = tree.find(s => s.id === activeId)
  const shown = visibleNodes(tree, collapsed)

  function toggle(id: number) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
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
    if (section.totalCount > 0) parts.push(`안의 메모 ${section.totalCount}개는 미분류로 옮겨져요.`)
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
    <nav className="sections" aria-labelledby="sections-title">
      <h2 id="sections-title" className="sections__title">섹션</h2>
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
              <div className="section-row">
                {s.childIds.length > 0 ? (
                  <button type="button" className="section-row__toggle" aria-expanded={!collapsed.has(s.id)}
                          aria-label={`${s.name} 하위 섹션 ${collapsed.has(s.id) ? '펼치기' : '접기'}`}
                          onClick={() => toggle(s.id)}>
                    <span aria-hidden="true">{collapsed.has(s.id) ? '▸' : '▾'}</span>
                  </button>
                ) : <span className="section-row__spacer" aria-hidden="true" />}
                <button type="button" className="section-item" aria-current={activeId === s.id ? 'true' : undefined}
                        onClick={() => onSelect(s.id)}>
                  <span>{s.name}</span><span className="section-item__count">{s.totalCount}</span>
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

      {editing?.kind === 'add' && editing.parentId === null ? (
        <NameInput label="새 섹션 이름" initial="" onSave={save} onCancel={cancel} />
      ) : (
        <button type="button" className="textbtn sections__add" onClick={() => { setEditing({ kind: 'add', parentId: null }); setError('') }}>
          + 섹션 추가
        </button>
      )}
      {error && <p className="field__error sections__error" role="alert">{error}</p>}

      {active && !active.isDefault && editing === null && (
        <div className="sections__actions">
          <p className="sections__selected">{active.path}</p>
          <button type="button" className="textbtn" onClick={() => setEditing({ kind: 'add', parentId: active.id })}>
            + 하위 섹션
          </button>
          <button type="button" className="textbtn" onClick={() => setEditing({ kind: 'rename', id: active.id })}>
            이름 바꾸기
          </button>
          <button type="button" className="textbtn textbtn--danger" onClick={() => remove(active)}>
            섹션 지우기
          </button>
        </div>
      )}
    </nav>
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
