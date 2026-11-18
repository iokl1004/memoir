import { useSyncExternalStore } from 'react'

/** 목록과 검색 미리보기의 날짜 (2026년 11월 18일) */
export const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

/** CSS 미디어 쿼리가 맞는지. 화면 크기가 바뀌면 다시 그려요. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
  )
}

/** 마우스 없이 손가락으로만 쓰는 기기. 길게 누르기와 아래쪽 동작 막대를 써요. */
export const touchOnly = window.matchMedia('(hover: none)').matches
