import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { api, type MemoFilter, type MemoSummary } from './api'
import SectionOptions from './SectionOptions'
import type { SectionNode } from './sectionTree'
import { dateFmt } from './shared'

type Period = 'all' | '7' | '30' | '90' | 'custom'

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

export default function SearchBar({ tree, filter, onSearch, onOpenMemo }: {
  tree: SectionNode[]
  filter: MemoFilter
  onSearch: (f: MemoFilter) => void
  onOpenMemo: (memo: MemoSummary) => void
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

  function openMemo(memo: MemoSummary) {
    setOpen(false)
    onOpenMemo(memo)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (open && suggest && active >= 0 && active < suggest.items.length) { openMemo(suggest.items[active]); return }
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
                      onClick={() => openMemo(m)}>
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
