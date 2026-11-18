import { describe, expect, it } from 'vitest'
import type { Section } from './api'
import { buildTree, moveTargets, subtreeIds, visibleNodes } from './sectionTree'

// 서버가 보내는 순서(사용자 지정 순서) 그대로예요.
let nextId = 1
function section(name: string, parentId: number | null = null, extra: Partial<Section> = {}): Section {
  return { id: nextId++, parentId, name, isDefault: false, memoCount: 0, createdAt: `2026-11-0${nextId}T00:00:00`, ...extra }
}

const inbox = section('미분류', null, { isDefault: true, memoCount: 2 })
const companyA = section('A회사', null, { memoCount: 1 })
const project = section('프로젝트 10', companyA.id, { memoCount: 3 })
const meeting = section('회의', project.id, { memoCount: 4 })
const project2 = section('프로젝트 9', companyA.id)
const companyB = section('B회사')
const all = [inbox, companyA, project, meeting, project2, companyB]

describe('buildTree', () => {
  it('부모 다음에 자식이 오고, 하위 메모 수와 경로를 계산한다', () => {
    const tree = buildTree(all)
    expect(tree.map(n => n.name)).toEqual(['미분류', 'A회사', '프로젝트 10', '회의', '프로젝트 9', 'B회사'])
    const a = tree.find(n => n.id === companyA.id)!
    expect(a.totalCount).toBe(1 + 3 + 4)
    expect(a.descendantCount).toBe(3)
    expect(tree.find(n => n.id === meeting.id)!.path).toBe('A회사 › 프로젝트 10 › 회의')
  })

  it('이름 정렬은 숫자를 크기로 비교하고, 미분류는 언제나 맨 위다', () => {
    const asc = buildTree(all, { key: 'NAME', dir: 'ASC' }).filter(n => n.parentId === companyA.id).map(n => n.name)
    expect(asc).toEqual(['프로젝트 9', '프로젝트 10'])
    const desc = buildTree(all, { key: 'NAME', dir: 'DESC' })
    expect(desc[0].name).toBe('미분류')
    expect(desc.filter(n => n.depth === 0).map(n => n.name)).toEqual(['미분류', 'B회사', 'A회사'])
  })
})

describe('subtreeIds, moveTargets, visibleNodes', () => {
  const tree = buildTree(all)

  it('하위 섹션 전체를 찾는다', () => {
    expect([...subtreeIds(tree, companyA.id)].sort()).toEqual([companyA.id, project.id, meeting.id, project2.id].sort())
  })

  it('자기 자신과 하위, 미분류, 지금 부모로는 옮길 수 없다', () => {
    const targets = moveTargets(tree, project.id).map(t => t?.name ?? '최상위')
    expect(targets).toEqual(['최상위', '프로젝트 9', 'B회사'])
  })

  it('접힌 섹션의 하위는 숨긴다', () => {
    expect(visibleNodes(tree, new Set([companyA.id])).map(n => n.name)).toEqual(['미분류', 'A회사', 'B회사'])
  })
})
