import type { Section } from './api'

export type SectionNode = Section & {
  depth: number
  /** 이 섹션과 모든 하위 섹션의 메모 수 */
  totalCount: number
  /** 하위 섹션 수 (모든 단계) */
  descendantCount: number
  childIds: number[]
  /** 예: A회사 › A프로젝트 */
  path: string
}

/** 평평한 섹션 목록을 트리 순서(부모 다음에 자식)로 펼쳐요. 서버가 준 순서(미분류, 만든 순)를 형제 순서로 써요. */
export function buildTree(sections: Section[]): SectionNode[] {
  const children = new Map<number | null, Section[]>()
  for (const s of sections) {
    const key = s.parentId !== null && sections.some(p => p.id === s.parentId) ? s.parentId : null
    children.set(key, [...(children.get(key) ?? []), s])
  }

  const out: SectionNode[] = []
  function visit(s: Section, depth: number, parentPath: string): SectionNode {
    const node: SectionNode = {
      ...s, depth, totalCount: s.memoCount, descendantCount: 0,
      childIds: (children.get(s.id) ?? []).map(c => c.id),
      path: parentPath ? `${parentPath} › ${s.name}` : s.name,
    }
    out.push(node)
    for (const child of children.get(s.id) ?? []) {
      const c = visit(child, depth + 1, node.path)
      node.totalCount += c.totalCount
      node.descendantCount += 1 + c.descendantCount
    }
    return node
  }
  for (const root of children.get(null) ?? []) visit(root, 0, '')
  return out
}

/** 접힌 섹션의 하위는 빼고 보여줄 목록 */
export function visibleNodes(nodes: SectionNode[], collapsed: Set<number>): SectionNode[] {
  const hidden = new Set<number>()
  for (const n of nodes) {
    if (hidden.has(n.id) || collapsed.has(n.id)) n.childIds.forEach(id => hidden.add(id))
  }
  return nodes.filter(n => !hidden.has(n.id))
}
