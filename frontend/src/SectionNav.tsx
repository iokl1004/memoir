import { useId, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from 'react'
import { ApiError, type MemoSummary } from './api'
import { useConfirm } from './confirm'
import ContextMenu from './ContextMenu'
import { moveTargets, subtreeIds, visibleNodes, type SectionNode, type SectionSort } from './sectionTree'
import SortPicker from './SortPicker'
import { SECTION_SORT_FIELDS } from './sorting'
import { touchOnly } from './shared'
import { store } from './store'

type Editing =
  | { kind: 'add'; parentId: number | null }
  | { kind: 'rename'; id: number }
  /** 끌 수 없는 터치 화면에서 옮길 곳을 목록으로 골라요. */
  | { kind: 'move'; id: number }
  | null
/** 끌어 놓을 곳: 섹션의 위(before)·아래(after)·안(into), 또는 'root'(최상위) */
type Place = 'before' | 'after' | 'into'
type DropTarget = { id: number; place: Place } | 'root' | null

export default function SectionNav({ tree, sort, onSortChange, draggingMemos, onMemosDrop, activeId, onSelect, onChanged, onDeleted, onError, paneCollapsed, onPaneCollapsedChange, drawer }: {
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
  /** 좁은 화면에서 서랍으로 열려 있는지 */
  drawer: boolean
}) {
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Editing>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  /** 섹션을 우클릭(또는 메뉴 키)했을 때 띄우는 메뉴 */
  const [menu, setMenu] = useState<{ section: SectionNode; x: number; y: number } | null>(null)
  /** 터치 화면에서 섹션을 길게 누르면 우클릭 메뉴를 띄워요. 메뉴를 띄운 뒤 오는 click은 무시해요. */
  const press = useRef<{ timer: number; fired: boolean } | null>(null)

  function startPress(e: PointerEvent<HTMLDivElement>, s: SectionNode) {
    if (e.pointerType !== 'touch' || s.isDefault) return
    const { clientX: x, clientY: y } = e
    const p = { fired: false, timer: 0 }
    p.timer = window.setTimeout(() => { p.fired = true; setMenu({ section: s, x, y }); navigator.vibrate?.(20) }, 500)
    press.current = p
  }

  function endPress() {
    if (press.current) window.clearTimeout(press.current.timer)
  }
  // 고른 섹션이 바뀌면(검색에서 메모를 열 때 등) 접힌 상위 섹션을 펼쳐서 고른 섹션이 보이게 해요.
  const [seenActive, setSeenActive] = useState(activeId)
  if (activeId !== seenActive) {
    setSeenActive(activeId)
    const next = new Set(collapsed)
    for (let p = tree.find(s => s.id === activeId)?.parentId; p != null; p = tree.find(s => s.id === p)?.parentId) next.delete(p)
    if (next.size !== collapsed.size) setCollapsed(next)
  }
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
      await store.moveSection(id, parentId, beforeId)
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
        await store.createSection(trimmed, editing.parentId)
        if (editing.parentId !== null) setCollapsed(prev => { const n = new Set(prev); n.delete(editing.parentId!); return n })
      } else if (editing?.kind === 'rename') {
        await store.renameSection(editing.id, trimmed)
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
      await store.deleteSection(section.id)
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
    <nav className="sections" aria-labelledby="sections-title" data-collapsed={paneCollapsed || undefined}
         data-drawer={drawer || undefined}>
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
            <span aria-hidden="true">{drawer ? '✕' : '«'}</span><span className="sr-only">{drawer ? '섹션 닫기' : '섹션 접기'}</span>
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
                draggable={!s.isDefault && !touchOnly}
                onPointerDown={e => startPress(e, s)}
                onPointerUp={endPress}
                onPointerLeave={endPress}
                onPointerCancel={endPress}
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
                  // 터치에서는 길게 누르기 타이머가 메뉴를 띄워요.
                  if (touchOnly) return
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
                        onClick={() => {
                          if (press.current?.fired) { press.current = null; return }
                          onSelect(s.id)
                        }}
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
            {editing?.kind === 'move' && editing.id === s.id && (
              <MovePicker section={s} targets={moveTargets(tree, s.id)} onCancel={cancel}
                          onMove={parentId => move(s.id, parentId)} />
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
                       // PC는 끌어서 옮겨요. 끌 수 없는 터치 화면에만 보여요.
                       ...(touchOnly ? [{ label: '다른 곳으로 옮기기', run: () => { setEditing({ kind: 'move', id: menu.section.id }); setError('') } }] : []),
                       { label: '섹션 지우기', danger: true, run: () => remove(menu.section) },
                     ]} />
      )}
      </div>
    </nav>
  )
}


/** 섹션을 옮길 곳을 목록에서 골라요. (끌기가 안 되는 터치 화면용) */
function MovePicker({ section, targets, onMove, onCancel }: {
  section: SectionNode
  targets: (SectionNode | null)[]
  onMove: (parentId: number | null) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(targets[0] === null ? 'root' : String(targets[0]?.id ?? ''))
  const id = useId()
  return (
    <form className="name-input section-child-input"
          onSubmit={e => { e.preventDefault(); if (value) onMove(value === 'root' ? null : Number(value)) }}>
      <label htmlFor={id} className="name-input__label">'{section.name}'을(를) 어디로 옮길까요?</label>
      {targets.length === 0 ? (
        <p className="name-input__label">옮길 수 있는 곳이 없어요.</p>
      ) : (
        <select id={id} value={value} onChange={e => setValue(e.target.value)}>
          {targets.map(t => t === null
            ? <option key="root" value="root">최상위</option>
            : <option key={t.id} value={t.id}>{t.path}</option>)}
        </select>
      )}
      <div className="name-input__actions">
        {targets.length > 0 && <button type="submit" className="btn btn--primary btn--sm">옮기기</button>}
        <button type="button" className="btn btn--secondary btn--sm" onClick={onCancel}>취소</button>
      </div>
    </form>
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
