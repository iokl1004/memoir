import type { MemoSort } from './api'
import type { SectionSort, SectionSortKey } from './sectionTree'

export type Dir = 'ASC' | 'DESC'
export type MemoSortField = 'TITLE' | 'UPDATED' | 'CREATED' | 'CUSTOM'

export const MEMO_SORT_FIELDS: { value: MemoSortField; label: string }[] = [
  { value: 'TITLE', label: '이름' },
  { value: 'UPDATED', label: '수정한 날짜' },
  { value: 'CREATED', label: '만든 날짜' },
  { value: 'CUSTOM', label: '사용자 지정' },
]
export const SECTION_SORT_FIELDS: { value: SectionSortKey; label: string }[] = [
  { value: 'NAME', label: '이름' },
  { value: 'CREATED', label: '만든 날짜' },
  { value: 'CUSTOM', label: '사용자 지정' },
]
const ALL_MEMO_SORTS: MemoSort[] = ['CREATED_DESC', 'CREATED_ASC', 'UPDATED_DESC', 'UPDATED_ASC', 'TITLE_ASC', 'TITLE_DESC', 'CUSTOM']


/** 'CREATED_DESC' 같은 서버 정렬 값을 기준과 방향으로 나눠요. 사용자 지정은 방향이 없어요. */
export function splitMemoSort(sort: MemoSort): { field: MemoSortField; dir: Dir } {
  if (sort === 'CUSTOM') return { field: 'CUSTOM', dir: 'ASC' }
  const [field, dir] = sort.split('_') as [MemoSortField, Dir]
  return { field, dir }
}

export function joinMemoSort(field: MemoSortField, dir: Dir): MemoSort {
  return field === 'CUSTOM' ? 'CUSTOM' : (`${field}_${dir}` as MemoSort)
}

export function savedSort(): MemoSort {
  const s = localStorage.getItem('memoir-sort')
  return ALL_MEMO_SORTS.includes(s as MemoSort) ? (s as MemoSort) : 'CREATED_DESC'
}

export function savedSectionSort(): SectionSort {
  try {
    const s = JSON.parse(localStorage.getItem('memoir-section-sort') ?? '')
    if (SECTION_SORT_FIELDS.some(f => f.value === s.key) && (s.dir === 'ASC' || s.dir === 'DESC')) return s
  } catch { /* 저장된 값이 없거나 깨졌으면 기본값 */ }
  return { key: 'CUSTOM', dir: 'ASC' }
}
