import { useRef, useState, type FormEvent } from 'react'
import { api, ApiError, type User } from './api'

type Mode = 'login' | 'signup'
type Errors = { email?: string; password?: string }

const PASSWORD_RULE = /^[\x21-\x7E]{8,64}$/

export default function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const isSignup = mode === 'signup'

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')

    // 오류는 제출할 때만 확인하고, 각 칸 아래에 이유를 적어요.
    const next: Errors = {}
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) next.email = '이메일을 @가 들어간 형식으로 적어 주세요.'
    if (!password) next.password = '비밀번호를 적어 주세요.'
    else if (isSignup && !PASSWORD_RULE.test(password))
      next.password = '비밀번호는 공백 없이 영문, 숫자, 특수문자로 8~64자여야 해요.'
    setErrors(next)
    if (next.email || next.password) {
      ;(next.email ? emailRef : passwordRef).current?.focus()
      setStatus(`확인할 칸이 ${Object.keys(next).length}개 있어요.`)
      return
    }

    setBusy(true)
    setStatus(isSignup ? '가입하는 중' : '로그인하는 중')
    try {
      if (isSignup) await api.signup(email, password)
      onLogin(await api.login(email, password))
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : '서버와 연결하지 못했어요.')
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(isSignup ? 'login' : 'signup')
    setErrors({})
    setStatus('')
  }

  return (
    <main className="auth">
      <div className="auth__panel">
        <p className="brand">
          <span className="brand__mark" aria-hidden="true">m</span> memoir
        </p>
        <h1 className="auth__title">{isSignup ? 'memoir 계정 만들기' : 'memoir에 로그인'}</h1>
        <p className="auth__lead">섹션별로 나눠 쓰고, 키워드와 작성일로 다시 찾는 메모장이에요.</p>

        <form className="form auth__form" onSubmit={submit} noValidate>
          <div className="field field--full">
            <label htmlFor="email">이메일</label>
            <input ref={emailRef} id="email" name="email" type="email" autoComplete="email"
                   aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} />
            {errors.email && <p id="email-error" className="field__error">{errors.email}</p>}
          </div>
          <div className="field field--full">
            <label htmlFor="password">비밀번호</label>
            <input ref={passwordRef} id="password" name="password" type="password"
                   autoComplete={isSignup ? 'new-password' : 'current-password'}
                   aria-invalid={!!errors.password}
                   aria-describedby={errors.password ? 'password-error' : isSignup ? 'password-hint' : undefined} />
            {errors.password
              ? <p id="password-error" className="field__error">{errors.password}</p>
              : isSignup && <p id="password-hint" className="field__hint">공백 없이 영문, 숫자, 특수문자로 8~64자</p>}
          </div>
          <div className="btn-row">
            <button className="btn btn--primary auth__submit" type="submit" disabled={busy}>
              {isSignup ? '계정 만들기' : '로그인하기'}
            </button>
          </div>
          <p className="form__status" role="status">{status}</p>
        </form>

        <p className="auth__switch">
          {isSignup ? '이미 계정이 있나요?' : '처음 쓰시나요?'}{' '}
          <button type="button" className="textbtn" onClick={switchMode}>
            {isSignup ? '로그인하기' : '계정 만들기'}
          </button>
        </p>
      </div>
    </main>
  )
}
