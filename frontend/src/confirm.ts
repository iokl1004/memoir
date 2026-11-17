import { createContext, useContext } from 'react'

export type ConfirmOptions = {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel?: string
  /** 되돌릴 수 없는 일이면 true: 확인 버튼이 붉어지고, 처음 포커스는 취소에 가요. */
  danger?: boolean
}

export const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(
  () => Promise.resolve(false),
)

/** 브라우저 confirm 대신 화면 안의 확인 창을 띄우고, 고른 답을 돌려줘요. */
export function useConfirm() {
  return useContext(ConfirmContext)
}
