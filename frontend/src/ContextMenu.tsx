import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export type MenuItem = { label: string; danger?: boolean; run: () => void }

/** 마우스 위치에 뜨는 작은 메뉴. 바깥을 누르거나 Esc, 스크롤하면 닫혀요. ↑↓로 고르고 Enter로 실행해요. */
export default function ContextMenu({ x, y, label, items, onClose }: {
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
