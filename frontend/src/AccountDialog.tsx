import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, type User } from './api'
import { useConfirm } from './confirm'
import { IMAGE_QUOTA_MB } from './images'

const PASSWORD_RULE = /^[\x21-\x7E]{8,64}$/

/** 계정 창: 패스워드 변경과 계정 지우기. 둘 다 현재 패스워드를 한 번 더 받아요. */
export default function AccountDialog({ user, onClose, onDeleted }: {
  user: User
  onClose: () => void
  /** 계정을 지운 뒤(이미 로그아웃된 상태) */
  onDeleted: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const confirm = useConfirm()

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog ref={ref} className="dialog account" aria-labelledby="account-title"
            onCancel={e => { e.preventDefault(); onClose() }}
            onClick={e => { if (e.target === ref.current) onClose() }}>
      <div className="account__head">
        <h2 id="account-title" className="dialog__title">계정</h2>
        <button type="button" className="collapse-btn" onClick={onClose}>
          <span aria-hidden="true">✕</span><span className="sr-only">계정 창 닫기</span>
        </button>
      </div>
      <p className="account__email">{user.email}</p>
      <ImageUsage />
      <ChangePassword />
      <DeleteAccount email={user.email} confirm={confirm} onDeleted={onDeleted} />
    </dialog>
  )
}

function ChangePassword() {
  const [errors, setErrors] = useState<{ current?: string; next?: string; again?: string }>({})
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const current = String(form.get('current') ?? '')
    const next = String(form.get('next') ?? '')
    const again = String(form.get('again') ?? '')
    const errs: typeof errors = {}
    if (!current) errs.current = '현재 패스워드를 적어 주세요.'
    if (!PASSWORD_RULE.test(next)) errs.next = '패스워드는 공백 없이 영문, 숫자, 특수문자로 8~64자여야 해요.'
    else if (next !== again) errs.again = '두 패스워드가 달라요. 같게 적어 주세요.'
    setErrors(errs)
    if (Object.keys(errs).length) {
      formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
      setStatus('')
      return
    }
    setBusy(true)
    setStatus('바꾸는 중')
    try {
      await api.changePassword(current, next)
      formRef.current?.reset()
      setStatus('패스워드를 변경했어요. 다른 기기의 로그인은 풀렸어요.')
    } catch (err) {
      // 현재 패스워드가 틀렸다는 답이면 그 칸 아래에 보여줘요.
      if (err instanceof ApiError && err.status === 400 && err.message.startsWith('현재')) {
        setErrors({ [err.message.startsWith('현재 패스워드') ? 'current' : 'next']: err.message })
        setStatus('')
      } else {
        setStatus(err instanceof ApiError ? err.message : '서버와 연결하지 못했어요.')
      }
    }
    setBusy(false)
  }

  return (
    <form ref={formRef} className="form account__section" onSubmit={submit} noValidate>
      <h3 className="account__label">패스워드 변경</h3>
      <Field name="current" label="현재 패스워드" autoComplete="current-password" error={errors.current} />
      <Field name="next" label="새 패스워드" autoComplete="new-password" error={errors.next}
             hint="공백 없이 영문, 숫자, 특수문자로 8~64자" />
      <Field name="again" label="새 패스워드 확인" autoComplete="new-password" error={errors.again} />
      <div className="btn-row">
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>패스워드 변경</button>
      </div>
      <p className="form__status" role="status">{status}</p>
    </form>
  )
}

function DeleteAccount({ email, confirm, onDeleted }: {
  email: string
  confirm: ReturnType<typeof useConfirm>
  onDeleted: () => void
}) {
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const password = String(new FormData(e.currentTarget).get('password') ?? '')
    if (!password) { setError('현재 패스워드를 적어 주세요.'); return }
    setError('')
    const ok = await confirm({
      title: '계정을 정말 지울까요?',
      body: `${email} 계정과 모든 섹션, 메모, 그림이 지워지고 되살릴 수 없어요.`,
      confirmLabel: '계정 지우기',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setStatus('지우는 중')
    try {
      await api.deleteAccount(password)
      onDeleted()
    } catch (err) {
      setStatus('')
      if (err instanceof ApiError && err.status === 400) setError(err.message)
      else setStatus(err instanceof ApiError ? err.message : '서버와 연결하지 못했어요.')
      setBusy(false)
    }
  }

  return (
    <form className="form account__section account__danger" onSubmit={submit} noValidate>
      <h3 className="account__label">계정 지우기</h3>
      <p className="account__note">계정과 모든 섹션, 메모, 그림이 지워지고 되살릴 수 없어요.</p>
      <Field name="password" label="현재 패스워드" autoComplete="current-password" error={error} />
      <div className="btn-row">
        <button type="submit" className="btn btn--primary btn--danger btn--sm" disabled={busy}>계정 지우기</button>
      </div>
      <p className="form__status" role="status">{status}</p>
    </form>
  )
}

/** 그림 저장 공간을 얼마나 썼는지. 다 차기 전에 미리 정리할 수 있게 보여줘요. */
function ImageUsage() {
  const [used, setUsed] = useState<number | null>(null)
  useEffect(() => { api.imageUsage().then(setUsed, () => setUsed(null)) }, [])
  if (used === null) return null
  const mb = used / 1024 / 1024
  return (
    <div className="account__section account__usage">
      <h3 className="account__label" id="usage-label">그림 저장 공간</h3>
      <meter className="usage__meter" min={0} max={IMAGE_QUOTA_MB} value={mb} high={IMAGE_QUOTA_MB * 0.8}
             aria-labelledby="usage-label" />
      <p className="account__note">
        {mb < 0.1 && used > 0 ? '0.1' : mb.toFixed(1)}MB / {IMAGE_QUOTA_MB}MB 사용
        {mb >= IMAGE_QUOTA_MB * 0.8 && ' · 거의 다 찼어요. 그림이 든 메모를 지우면 공간이 생겨요.'}
      </p>
    </div>
  )
}

function Field({ name, label, autoComplete, error, hint }: {
  name: string
  label: string
  autoComplete: string
  error?: string
  hint?: string
}) {
  const id = `account-${name}`
  return (
    <div className="field field--full">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} type="password" autoComplete={autoComplete} aria-invalid={!!error}
             aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} />
      {error
        ? <p id={`${id}-error`} className="field__error">{error}</p>
        : hint && <p id={`${id}-hint`} className="field__hint">{hint}</p>}
    </div>
  )
}
