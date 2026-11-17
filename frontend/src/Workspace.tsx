import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type MemoFilter, type MemoSummary, type Section, type User } from './api'
import MemoEditor from './MemoEditor'

type Selection = { kind: 'none' } | { kind: 'new' } | { kind: 'memo'; id: number }
type Period = 'all' | '7' | '30' | '90' | 'custom'

const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

export default function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [sections, setSections] = useState<Section[]>([])
  const [filter, setFilter] = useState<MemoFilter>({})
  const [memos, setMemos] = useState<MemoSummary[]>([])
  const [page, setPage] = useState({ number: 0, totalPages: 0, total: 0 })
  // 첫 목록이 오기 전에 "메모가 없어요"가 잠깐 보이지 않게 해요.
  const [loaded, setLoaded] = useState(false)
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) onLogout()
    else setStatus(err instanceof ApiError ? err.message : '서버와 연결하지 못했어요.')
  }, [onLogout])

  const loadSections = useCallback(() => api.sections().then(setSections, fail), [fail])

  const loadMemos = useCallback((f: MemoFilter, pageNumber: number) =>
    api.memos(f, pageNumber).then(p => {
      setMemos(prev => (pageNumber === 0 ? p.items : [...prev, ...p.items]))
      setPage({ number: p.page, totalPages: p.totalPages, total: p.totalElements })
      setLoaded(true)
    }, fail), [fail])

  useEffect(() => { loadSections() }, [loadSections])
  useEffect(() => { loadMemos(filter, 0) }, [filter, loadMemos])

  /** 저장하지 않은 내용이 있으면 물어보고, 그래도 떠나기로 하면 true */
  function confirmLeave(): boolean {
    return !dirty || window.confirm('저장하지 않은 내용이 있어요. 저장하지 않고 이동할까요?')
  }

  function select(next: Selection) {
    if (!confirmLeave()) return
    setDirty(false)
    setSelection(next)
  }

  function applyFilter(next: MemoFilter) {
    if (!confirmLeave()) return
    setDirty(false)
    setSelection({ kind: 'none' })
    setStatus('')
    setFilter(next)
  }

  function refreshAfterChange() {
    loadSections()
    loadMemos(filter, 0)
  }

  async function logout() {
    if (!confirmLeave()) return
    await api.logout().catch(() => undefined)
    onLogout()
  }

  const defaultSection = sections.find(s => s.isDefault)
  const searching = !!(filter.q || filter.from || filter.to)
  const currentSection = sections.find(s => s.id === filter.sectionId)
  const listTitle = searching ? '검색 결과' : currentSection?.name ?? '전체 메모'

  return (
    <div className="app" data-view={selection.kind === 'none' ? 'list' : 'editor'}>
      <header className="topbar">
        <p className="brand"><span className="brand__mark" aria-hidden="true">m</span> memoir</p>
        <SearchBar key={JSON.stringify(filter)} sections={sections} filter={filter} onSearch={applyFilter} />
        <div className="topbar__user">
          <span className="topbar__email">{user.email}</span>
          <button type="button" className="textbtn" onClick={logout}>로그아웃</button>
        </div>
      </header>

      <SectionNav
        sections={sections}
        activeId={filter.sectionId}
        onSelect={id => applyFilter({ ...filter, sectionId: id })}
        onChanged={refreshAfterChange}
        onDeleted={id => { if (filter.sectionId === id) applyFilter({ ...filter, sectionId: undefined }); else refreshAfterChange() }}
        onError={fail}
      />

      <section className="list" aria-labelledby="list-title">
        <div className="list__head">
          <h1 id="list-title" className="list__title">
            {listTitle} {loaded && <span className="muted">{page.total}개</span>}
          </h1>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => select({ kind: 'new' })}>
            새 메모 쓰기
          </button>
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
          <ul className="memo-list">
            {memos.map(m => (
              <li key={m.id}>
                <button
                  type="button"
                  className="memo-item"
                  aria-current={selection.kind === 'memo' && selection.id === m.id ? 'true' : undefined}
                  onClick={() => select({ kind: 'memo', id: m.id })}
                >
                  <span className="memo-item__title">{m.title}</span>
                  {m.preview && <span className="memo-item__preview">{m.preview}</span>}
                  <span className="memo-item__meta">
                    <time dateTime={m.createdAt}>{dateFmt.format(new Date(m.createdAt))}</time>
                    {filter.sectionId === undefined && (
                      <> · {sections.find(s => s.id === m.sectionId)?.name}</>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {page.number + 1 < page.totalPages && (
          <button type="button" className="btn btn--secondary list__more" onClick={() => loadMemos(filter, page.number + 1)}>
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
            sections={sections}
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

function describeFilter(f: MemoFilter, section?: Section): string {
  const parts = []
  if (f.q) parts.push(`"${f.q}"`)
  if (section) parts.push(`${section.name} 섹션`)
  if (f.from || f.to) parts.push(`${f.from ?? '처음'} ~ ${f.to ?? '오늘'}`)
  return parts.join(' · ')
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

function SearchBar({ sections, filter, onSearch }: {
  sections: Section[]
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
        {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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

function SectionNav({ sections, activeId, onSelect, onChanged, onDeleted, onError }: {
  sections: Section[]
  activeId?: number
  onSelect: (id?: number) => void
  onChanged: () => void
  onDeleted: (id: number) => void
  onError: (err: unknown) => void
}) {
  const [adding, setAdding] = useState(false)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const total = sections.reduce((n, s) => n + s.memoCount, 0)
  const active = sections.find(s => s.id === activeId)

  async function save(name: string, id: number | null) {
    const trimmed = name.trim()
    if (!trimmed) { setError('섹션 이름을 적어 주세요.'); return }
    try {
      if (id === null) await api.createSection(trimmed)
      else await api.renameSection(id, trimmed)
      setAdding(false)
      setRenamingId(null)
      setError('')
      onChanged()
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) setError(err.message)
      else onError(err)
    }
  }

  async function remove(section: Section) {
    const moved = section.memoCount > 0 ? ` 안의 메모 ${section.memoCount}개는 미분류로 옮겨져요.` : ''
    if (!window.confirm(`'${section.name}' 섹션을 지울까요?${moved}`)) return
    try {
      await api.deleteSection(section.id)
      onDeleted(section.id)
    } catch (err) {
      onError(err)
    }
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
        {sections.map(s => (
          <li key={s.id}>
            {renamingId === s.id ? (
              <NameInput label="새 섹션 이름" initial={s.name} onSave={name => save(name, s.id)}
                         onCancel={() => { setRenamingId(null); setError('') }} />
            ) : (
              <button type="button" className="section-item" aria-current={activeId === s.id ? 'true' : undefined}
                      onClick={() => onSelect(s.id)}>
                <span>{s.name}</span><span className="section-item__count">{s.memoCount}</span>
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <NameInput label="새 섹션 이름" initial="" onSave={name => save(name, null)}
                   onCancel={() => { setAdding(false); setError('') }} />
      ) : (
        <button type="button" className="textbtn sections__add" onClick={() => { setAdding(true); setRenamingId(null) }}>
          + 섹션 추가
        </button>
      )}
      {error && <p className="field__error sections__error" role="alert">{error}</p>}

      {active && !active.isDefault && renamingId === null && (
        <div className="sections__actions">
          <button type="button" className="textbtn" onClick={() => { setRenamingId(active.id); setAdding(false) }}>
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
  return (
    <form className="name-input" onSubmit={e => { e.preventDefault(); onSave(name) }}>
      <label className="sr-only" htmlFor="section-name">{label}</label>
      <input id="section-name" autoFocus value={name} maxLength={30} onChange={e => setName(e.target.value)}
             onKeyDown={e => { if (e.key === 'Escape') onCancel() }} />
      <button type="submit" className="textbtn">저장</button>
      <button type="button" className="textbtn" onClick={onCancel}>취소</button>
    </form>
  )
}
