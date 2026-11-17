import type { SectionNode } from './sectionTree'

/** 섹션 고르기 목록: 하위 섹션은 들여 써서 보여줘요. */
export default function SectionOptions({ tree }: { tree: SectionNode[] }) {
  return tree.map(s => (
    <option key={s.id} value={s.id}>{'   '.repeat(s.depth)}{s.name}</option>
  ))
}
