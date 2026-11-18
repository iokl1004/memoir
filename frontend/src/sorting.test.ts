import { beforeEach, describe, expect, it } from 'vitest'
import { joinMemoSort, savedSectionSort, savedSort, splitMemoSort } from './sorting'

// vitest 기본 환경(node)에는 localStorage가 없어서 간단히 흉내 내요.
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: k => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
  removeItem: k => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

describe('메모 정렬 값', () => {
  it('기준과 방향으로 나누고 다시 합친다', () => {
    expect(splitMemoSort('UPDATED_ASC')).toEqual({ field: 'UPDATED', dir: 'ASC' })
    expect(joinMemoSort('TITLE', 'DESC')).toBe('TITLE_DESC')
  })

  it('사용자 지정은 방향이 없다', () => {
    expect(splitMemoSort('CUSTOM').field).toBe('CUSTOM')
    expect(joinMemoSort('CUSTOM', 'DESC')).toBe('CUSTOM')
  })
})

describe('저장된 정렬', () => {
  beforeEach(() => store.clear())

  it('없거나 깨진 값이면 기본값을 쓴다', () => {
    expect(savedSort()).toBe('CREATED_DESC')
    store.set('memoir-sort', 'NOPE')
    expect(savedSort()).toBe('CREATED_DESC')
    store.set('memoir-section-sort', '{broken')
    expect(savedSectionSort()).toEqual({ key: 'CUSTOM', dir: 'ASC' })
  })

  it('저장된 값을 그대로 돌려준다', () => {
    store.set('memoir-sort', 'TITLE_ASC')
    store.set('memoir-section-sort', JSON.stringify({ key: 'NAME', dir: 'DESC' }))
    expect(savedSort()).toBe('TITLE_ASC')
    expect(savedSectionSort()).toEqual({ key: 'NAME', dir: 'DESC' })
  })
})
