import type { Dir } from './sorting'

/** 정렬 기준과 방향 콤보박스 한 쌍. 사용자 지정이면 방향은 숨겨요. */
export default function SortPicker<F extends string>({ idPrefix, fields, field, dir, custom, onChange }: {
  idPrefix: string
  fields: { value: F; label: string }[]
  field: F
  dir: Dir
  custom: F
  onChange: (field: F, dir: Dir) => void
}) {
  return (
    <div className="sort-picker">
      <label className="sr-only" htmlFor={`${idPrefix}-field`}>정렬 기준</label>
      <select id={`${idPrefix}-field`} className="sort-picker__select" value={field}
              onChange={e => onChange(e.target.value as F, dir)}>
        {fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      {field !== custom && (
        <>
          <label className="sr-only" htmlFor={`${idPrefix}-dir`}>정렬 방향</label>
          <select id={`${idPrefix}-dir`} className="sort-picker__select" value={dir}
                  onChange={e => onChange(field, e.target.value as Dir)}>
            <option value="ASC">오름차순</option>
            <option value="DESC">내림차순</option>
          </select>
        </>
      )}
    </div>
  )
}
