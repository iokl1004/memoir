import { useEffect, useState } from 'react'
import { api, ApiError, type Memo } from './api'
import { useConfirm } from './confirm'
import SectionOptions from './SectionOptions'
import type { SectionNode } from './sectionTree'

const timeFmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
const MAX_CONTENT = 20_000

type Draft = { title: string; content: string; sectionId: number | undefined }

export default function MemoEditor({ memoId, tree, initialSectionId, onDirtyChange, onSaved, onDeleted, onClose, onError }: {
  memoId: number | null
  tree: SectionNode[]
  initialSectionId?: number
  onDirtyChange: (dirty: boolean) => void
  onSaved: (memo: Memo) => void
  onDeleted: () => void
  onClose: () => void
  onError: (err: unknown) => void
}) {
  const confirm = useConfirm()
  const [memo, setMemo] = useState<Memo | null>(null)
  const [saved, setSaved] = useState<Draft>({ title: '', content: '', sectionId: initialSectionId })
  const [draft, setDraft] = useState<Draft>(saved)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (memoId === null) return
    api.memo(memoId).then(m => {
      const d = { title: m.title, content: m.content, sectionId: m.sectionId }
      setMemo(m)
      setSaved(d)
      setDraft(d)
    }, onError)
  }, [memoId, onError])

  // 새 메모인데 섹션 목록이 늦게 오면, 고른 섹션이 없을 때 기본 섹션을 써요.
  const sectionId = draft.sectionId ?? initialSectionId

  const dirty = draft.title !== saved.title || draft.content !== saved.content || draft.sectionId !== saved.sectionId
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  // 저장하지 않은 채로 탭을 닫으면 브라우저가 한 번 물어봐요.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save() {
    if (sectionId === undefined || busy) return
    setBusy(true)
    setStatus('저장하는 중')
    try {
      const body = { title: draft.title, content: draft.content, sectionId }
      const result = memo ? await api.updateMemo(memo.id, body) : await api.createMemo(body)
      const d = { title: result.title, content: result.content, sectionId: result.sectionId }
      setMemo(result)
      setSaved(d)
      setDraft(d)
      setStatus('저장했어요.')
      onSaved(result)
    } catch (err) {
      // 실패해도 쓴 내용은 그대로 남겨요.
      setStatus(err instanceof ApiError ? `저장하지 못했어요. ${err.message}` : '저장하지 못했어요.')
      if (err instanceof ApiError && err.status === 401) onError(err)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!memo) return
    const ok = await confirm({
      title: `'${memo.title}' 메모를 지울까요?`,
      body: '지운 메모는 되살릴 수 없어요.',
      confirmLabel: '메모 지우기',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteMemo(memo.id)
      onDeleted()
    } catch (err) {
      onError(err)
    }
  }

  if (memoId !== null && !memo) return <p className="pane__loading" role="status">메모를 불러오는 중</p>

  return (
    <form
      className="editor"
      onSubmit={e => { e.preventDefault(); save() }}
      onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() }
      }}
    >
      <div className="editor__bar">
        <button type="button" className="textbtn editor__back" onClick={onClose}>← 목록으로</button>
        <label className="sr-only" htmlFor="memo-section">섹션</label>
        <select id="memo-section" value={sectionId ?? ''}
                onChange={e => setDraft({ ...draft, sectionId: Number(e.target.value) })}>
          <SectionOptions tree={tree} />
        </select>
        <span className="editor__state" aria-live="polite">{dirty ? '저장 안 됨' : memo ? '저장됨' : ''}</span>
      </div>

      <label className="sr-only" htmlFor="memo-title">제목</label>
      <input id="memo-title" className="editor__title" value={draft.title} maxLength={100}
             placeholder="제목 없음" onChange={e => setDraft({ ...draft, title: e.target.value })} />

      <label className="sr-only" htmlFor="memo-content">본문</label>
      <textarea id="memo-content" className="editor__content" value={draft.content} maxLength={MAX_CONTENT}
                placeholder="여기에 메모를 적어요" aria-describedby="memo-count"
                onChange={e => setDraft({ ...draft, content: e.target.value })} />

      <div className="editor__foot">
        <p className="editor__meta">
          {memo && <>작성 {timeFmt.format(new Date(memo.createdAt))} · 수정 {timeFmt.format(new Date(memo.updatedAt))} · </>}
          <span id="memo-count">{draft.content.length.toLocaleString('ko-KR')} / 20,000자</span>
        </p>
        <div className="btn-row">
          {memo && <button type="button" className="textbtn textbtn--danger" onClick={remove}>메모 지우기</button>}
          <button type="submit" className="btn btn--primary" disabled={busy || (!dirty && !!memo)}>메모 저장하기</button>
        </div>
      </div>
      <p className="status" role="status">{status}</p>
    </form>
  )
}
