import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { MemoSort, MemoSummary } from './api'
import ContextMenu from './ContextMenu'
import { dateFmt, touchOnly } from './shared'

// 터치 화면에서는 길게 누르기를 쓰려고 끌기를 꺼요(길게 누르면 브라우저가 끌기를 시작해요).
const LONG_PRESS_MS = 500

export default function MemoList({ memos, sort, selectedId, sectionLabel, onOpen, onDelete, onReorder, onDragMemos, checked, onToggle, onClearChecked }: {
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
