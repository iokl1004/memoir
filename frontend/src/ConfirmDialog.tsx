import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmContext, type ConfirmOptions } from './confirm'

type Pending = ConfirmOptions & { resolve: (answer: boolean) => void }

/** 확인 창 하나를 앱 전체가 함께 써요. <dialog>의 showModal로 띄워서 포커스 가두기와 Esc 닫기를 브라우저가 해요. */
export default function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>(resolve => setPending({ ...options, resolve })),
    [],
  )

  useEffect(() => {
    if (pending && !dialogRef.current?.open) dialogRef.current?.showModal()
  }, [pending])

  function answer(value: boolean) {
    pending?.resolve(value)
    dialogRef.current?.close()
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <dialog
          ref={dialogRef}
          className="dialog"
          aria-labelledby="dialog-title"
          aria-describedby={pending.body ? 'dialog-body' : undefined}
          onCancel={e => { e.preventDefault(); answer(false) }}
          onClick={e => { if (e.target === dialogRef.current) answer(false) }}
        >
          <h2 id="dialog-title" className="dialog__title">{pending.title}</h2>
          {pending.body && <p id="dialog-body" className="dialog__body">{pending.body}</p>}
          <div className="btn-row dialog__actions"
               onKeyDown={e => {
                 // ←→ 로도 [취소]와 [확인] 사이를 오가요. (Tab과 같은 순서, 끝에서 반대쪽으로 돌아가요)
                 if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                 const buttons = [...e.currentTarget.querySelectorAll('button')]
                 const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
                 if (i < 0) return
                 e.preventDefault()
                 buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length].focus()
               }}>
            <button type="button" className="btn btn--secondary" autoFocus={pending.danger}
                    onClick={() => answer(false)}>
              {pending.cancelLabel ?? '취소'}
            </button>
            <button type="button" className={`btn btn--primary${pending.danger ? ' btn--danger' : ''}`}
                    autoFocus={!pending.danger} onClick={() => answer(true)}>
              {pending.confirmLabel}
            </button>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  )
}
