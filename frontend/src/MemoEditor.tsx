import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extensions'
import { ApiError, type Memo } from './api'
import { editorSrc, toEditorHtml, toStoredHtml } from './images'
import { useConfirm } from './confirm'
import { onStore, resolve, store } from './store'

const timeFmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
const MAX_CONTENT = 20_000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

type Draft = { title: string; html: string }

/** 그림 기능 전에 쓴 메모(글자만)를 문단 HTML로 바꿔요. */
function textToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text.split('\n').map(line => `<p>${escape(line)}</p>`).join('')
}

/** 그림 번호(data-img)를 편집기 안에서도 잃지 않게 해요. 저장할 때 이 번호로 "/img/번호" 주소를 만들어요. */
const MemoImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      imageId: {
        default: null,
        parseHTML: el => el.getAttribute('data-img'),
        renderHTML: attrs => (attrs.imageId ? { 'data-img': attrs.imageId } : {}),
      },
    }
  },
})

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter(f => f.type.startsWith('image/'))
}

export default function MemoEditor({ memoId, initialSectionId, onDirtyChange, onSaved, onDeleted, onClose, onError }: {
  memoId: number | null
  initialSectionId?: number
  onDirtyChange: (dirty: boolean) => void
  onSaved: (memo: Memo) => void
  onDeleted: () => void
  onClose: () => void
  onError: (err: unknown) => void
}) {
  const confirm = useConfirm()
  const [memo, setMemoState] = useState<Memo | null>(null)
  // 바로 읽을 수 있게 ref에도 둬요. 고른 메모 번호가 바뀌어도(새 메모 저장, 충돌 사본) 같은 메모면 다시 불러오지 않아요.
  const memoRef = useRef<Memo | null>(null)
  const setMemo = (m: Memo) => { memoRef.current = m; setMemoState(m) }
  const [saved, setSaved] = useState<Draft>({ title: '', html: '' })
  const [draft, setDraft] = useState<Draft>(saved)
  const [textLength, setTextLength] = useState(0)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0)
  const editorRef = useRef<Editor | null>(null)

  /** 그림을 올리고 pos(없으면 커서 자리)에 넣어요. 붙여넣기와 끌어 놓기가 함께 써요. */
  async function insertImages(files: File[], pos?: number) {
    if (files.some(f => f.size > MAX_IMAGE_BYTES)) setStatus('그림은 한 장에 5MB까지 넣을 수 있어요.')
    const ok = files.filter(f => f.size <= MAX_IMAGE_BYTES)
    if (!ok.length) return
    setUploading(n => n + ok.length)
    setStatus('그림을 올리는 중')
    for (const file of ok) {
      try {
        const { id } = await store.uploadImage(file)
        const src = await editorSrc(id)
        const editor = editorRef.current
        if (!editor || editor.isDestroyed) return
        const node = { type: 'image', attrs: { src, imageId: String(id) } }
        if (pos === undefined) editor.chain().focus().insertContent(node).run()
        else editor.chain().focus().insertContentAt(pos, node).run()
        setStatus('')
      } catch (err) {
        setStatus(err instanceof ApiError ? `그림을 넣지 못했어요. ${err.message}` : '그림을 넣지 못했어요.')
        if (err instanceof ApiError && err.status === 401) onError(err)
      } finally {
        setUploading(n => n - 1)
      }
    }
  }
  // 편집기 핸들러는 처음 만들 때 한 번만 등록돼서, 항상 최신 함수를 부르도록 ref로 넘겨요.
  const insertRef = useRef(insertImages)
  useEffect(() => { insertRef.current = insertImages })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      // 그림을 고르면 좌우 모서리 손잡이가 생겨요. 비율은 그대로 두고 넓이만 바꿔요.
      MemoImage.configure({
        resize: { enabled: true, directions: ['left', 'right', 'bottom-left', 'bottom-right'], minWidth: 80, alwaysPreserveAspectRatio: true },
      }),
      Placeholder.configure({ placeholder: '여기에 메모를 적어요. 그림은 붙여넣거나 끌어다 놓으면 들어가요.' }),
    ],
    editorProps: {
      attributes: { id: 'memo-content', class: 'editor__content', 'aria-label': '본문', 'aria-describedby': 'memo-count' },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files)
        if (!files.length) return false
        event.preventDefault()
        insertRef.current(files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = moved ? [] : imageFiles(event.dataTransfer?.files)
        if (!files.length) return false
        event.preventDefault()
        insertRef.current(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos)
        return true
      },
    },
    onCreate: ({ editor }) => {
      if (memoId !== null) return
      // 새 메모: 편집기가 정리한 빈 본문을 저장된 값으로 삼아요.
      const empty = { title: '', html: editor.getHTML() }
      setSaved(empty)
      setDraft(empty)
    },
    onUpdate: ({ editor }) => {
      setDraft(d => ({ ...d, html: editor.getHTML() }))
      setTextLength(editor.getText().length)
    },
  })
  useEffect(() => { editorRef.current = editor }, [editor])

  useEffect(() => {
    if (memoId === null || !editor || memoRef.current?.id === memoId) return
    store.memo(memoId).then(async m => {
      const html = await toEditorHtml(m.contentHtml ?? textToHtml(m.content))
      if (editor.isDestroyed) return
      editor.commands.setContent(html, { emitUpdate: false })
      // 편집기가 HTML을 자기 모양으로 정리하니, 정리된 값을 기준으로 삼아야 "저장 안 됨"이 잘못 뜨지 않아요.
      const d = { title: m.title, html: editor.getHTML() }
      setMemo(m)
      setSaved(d)
      setDraft(d)
      setTextLength(editor.getText().length)
    }, onError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoId, editor, onError])

  // 보낼 때 다른 기기에서 고친 메모와 겹쳐 사본으로 저장했으면, 이제부터는 그 사본을 고쳐요(쓰던 내용은 그대로).
  useEffect(() => onStore('replaced', ({ from, row }) => {
    const m = memoRef.current
    if (!m || resolve(m.id) !== resolve(from)) return
    setMemo(row)
    // 저장 뒤에 제목을 더 고치는 중이면 그 제목은 그대로 둬요.
    setSaved(prev => {
      setDraft(d => (d.title === prev.title ? { ...d, title: row.title } : d))
      return { ...prev, title: row.title }
    })
    setStatus(`서버에서 바뀐 메모라, 고친 내용은 '${row.title}'(으)로 따로 저장했어요.`)
  }), [])

  const dirty = draft.title !== saved.title || draft.html !== saved.html
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  // 저장하지 않은 채로 탭을 닫으면 브라우저가 한 번 물어봐요.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save() {
    const sectionId = memo?.sectionId ?? initialSectionId
    if (sectionId === undefined || busy || !editor) return
    if (uploading > 0) { setStatus('그림을 다 올린 뒤에 저장해 주세요.'); return }
    setBusy(true)
    setStatus('저장하는 중')
    try {
      const html = editor.getHTML()
      const body = { title: draft.title, contentHtml: toStoredHtml(html), content: editor.getText({ blockSeparator: '\n' }), sectionId }
      const result = memo ? await store.updateMemo(memo.id, body, memo) : await store.createMemo(body)
      // 지금 편집기 값을 기준으로 둬요. 서버가 정리한 HTML과 모양이 조금 달라도 "저장 안 됨"이 뜨지 않게요.
      const d = { title: result.title, html }
      setMemo(result)
      setSaved(d)
      setDraft(d)
      setStatus(navigator.onLine ? '저장했어요.' : '이 기기에 저장했어요. 인터넷에 연결되면 서버에 보낼게요.')
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
      await store.deleteMemo(memo.id)
      onDeleted()
    } catch (err) {
      onError(err)
    }
  }

  const loading = memoId !== null && !memo

  return (
    <form
      className="editor"
      onSubmit={e => { e.preventDefault(); save() }}
      onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() }
      }}
    >
      {loading && <p className="pane__loading" role="status">메모를 불러오는 중</p>}
      <div className="editor__bar" hidden={loading}>
        <button type="button" className="textbtn editor__back" onClick={onClose}>← 목록으로</button>
        <span className="editor__state" aria-live="polite">{dirty ? '저장 안 됨' : memo ? '저장됨' : ''}</span>
      </div>

      <label className="sr-only" htmlFor="memo-title">제목</label>
      <input id="memo-title" className="editor__title" value={draft.title} maxLength={100} hidden={loading}
             placeholder="제목 없음" onChange={e => setDraft({ ...draft, title: e.target.value })} />

      {/* 편집기는 불러오는 동안에도 있어야 본문을 넣을 수 있어서, 감추기만 해요. */}
      <EditorContent editor={editor} className="editor__body" hidden={loading} />

      <div className="editor__foot" hidden={loading}>
        <p className="editor__meta">
          {memo && <>
            <span>작성 {timeFmt.format(new Date(memo.createdAt))}</span>
            <span>수정 {timeFmt.format(new Date(memo.updatedAt))}</span>
          </>}
          <span id="memo-count" data-over={textLength > MAX_CONTENT || undefined}>
            {textLength.toLocaleString('ko-KR')} / 20,000자
          </span>
        </p>
        <div className="btn-row">
          {memo && <button type="button" className="textbtn textbtn--danger" onClick={remove}>메모 지우기</button>}
          <button type="submit" className="btn btn--primary" disabled={busy || uploading > 0 || (!dirty && !!memo)}>메모 저장하기</button>
        </div>
      </div>
      <p className="status" role="status">{status}</p>
    </form>
  )
}
