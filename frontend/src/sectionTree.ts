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

/** 이 섹션과 모든 하위 섹션의 id. 트리 순서(부모 다음에 자식)라서 깊이가 같거나 얕아지면 끝이에요. */
export function subtreeIds(nodes: SectionNode[], id: number): Set<number> {
  const start = nodes.findIndex(n => n.id === id)
  const ids = new Set<number>()
  if (start < 0) return ids
  ids.add(id)
  for (let i = start + 1; i < nodes.length && nodes[i].depth > nodes[start].depth; i++) ids.add(nodes[i].id)
  return ids
}

/** 섹션을 옮길 수 있는 곳: 자기 자신과 하위, 미분류, 지금 있는 곳은 빼요. null은 최상위 */
export function moveTargets(nodes: SectionNode[], id: number): (SectionNode | null)[] {
  const self = nodes.find(n => n.id === id)
  if (!self) return []
  const blocked = subtreeIds(nodes, id)
  const targets: (SectionNode | null)[] = nodes.filter(n => !n.isDefault && !blocked.has(n.id) && n.id !== self.parentId)
  return self.parentId === null ? targets : [null, ...targets]
}

/** 접힌 섹션의 하위는 빼고 보여줄 목록 */
export function visibleNodes(nodes: SectionNode[], collapsed: Set<number>): SectionNode[] {
  const hidden = new Set<number>()
  for (const n of nodes) {
    if (hidden.has(n.id) || collapsed.has(n.id)) n.childIds.forEach(id => hidden.add(id))
  }
  return nodes.filter(n => !hidden.has(n.id))
}
