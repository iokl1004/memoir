import { useRef, useState, type FormEvent } from 'react'
import { api, ApiError, type User } from './api'
import ThemeToggle from './ThemeToggle'

/** login·signup: 로그인과 가입, forgot: 비밀번호 찾기(메일 보내기), sent: 메일을 보낸 뒤, reset: 메일 링크로 새 비밀번호 정하기 */
type Mode = 'login' | 'signup' | 'forgot' | 'sent' | 'reset'
type Errors = { email?: string; password?: string; confirm?: string }

const PASSWORD_RULE = /^[\x21-\x7E]{8,64}$/
const PASSWORD_HINT = '공백 없이 영문, 숫자, 특수문자로 8~64자'

const TITLES: Record<Mode, string> = {
  login: 'memoir에 로그인',
  signup: 'memoir 계정 만들기',
  forgot: '비밀번호 찾기',
  sent: '메일을 확인해 주세요',
  reset: '새 비밀번호 정하기',
}
const SUBMIT: Partial<Record<Mode, string>> = {
  login: '로그인하기', signup: '계정 만들기', forgot: '재설정 링크 보내기', reset: '비밀번호 바꾸기',
}
const BUSY: Partial<Record<Mode, string>> = {
  login: '로그인하는 중', signup: '가입하는 중', forgot: '링크를 보내는 중', reset: '비밀번호를 바꾸는 중',
}

export default function AuthScreen({ onLogin, resetToken }: {
  onLogin: (user: User) => void
  /** 메일 링크(?reset=...)로 들어오면 그 토큰. 새 비밀번호 화면을 바로 보여줘요. */
  resetToken?: string
}) {
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login')
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const askEmail = mode === 'login' || mode === 'signup' || mode === 'forgot'
  const askPassword = mode === 'login' || mode === 'signup' || mode === 'reset'
  const newPassword = mode === 'signup' || mode === 'reset'

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const confirm = String(form.get('confirm') ?? '')

    // 오류는 제출할 때만 확인하고, 각 칸 아래에 이유를 적어요.
    const next: Errors = {}
    if (askEmail && !/^[^\s@]+@[^\s@]+$/.test(email)) next.email = '이메일을 @가 들어간 형식으로 적어 주세요.'
    if (askPassword && !password) next.password = '비밀번호를 적어 주세요.'
    else if (newPassword && !PASSWORD_RULE.test(password))
      next.password = '비밀번호는 공백 없이 영문, 숫자, 특수문자로 8~64자여야 해요.'
    if (mode === 'reset' && !next.password && confirm !== password) next.confirm = '두 비밀번호가 달라요. 같게 적어 주세요.'
    setErrors(next)
    const firstBad = next.email ? emailRef : next.password ? passwordRef : next.confirm ? confirmRef : null
    if (firstBad) {
      firstBad.current?.focus()
      setStatus(`확인할 칸이 ${Object.keys(next).length}개 있어요.`)
      return
    }

    setBusy(true)
    setStatus(BUSY[mode] ?? '')
    try {
      if (mode === 'forgot') {
        await api.requestPasswordReset(email)
        setSentTo(email)
        go('sent')
      } else if (mode === 'reset') {
        await api.confirmPasswordReset(resetToken ?? '', password)
        go('login', '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.')
      } else {
        if (mode === 'signup') await api.signup(email, password)
        onLogin(await api.login(email, password))
      }
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : '서버와 연결하지 못했어요.')
      setBusy(false)
    }
  }

  function go(next: Mode, message = '') {
    setMode(next)
    setErrors({})
    setStatus(message)
    setBusy(false)
  }

  return (
    <main className="auth">
      <div className="auth__theme"><ThemeToggle /></div>
      <div className="auth__panel">
        <p className="brand">
          <span className="brand__mark" aria-hidden="true">m</span> memoir
        </p>
        <h1 className="auth__title">{TITLES[mode]}</h1>
        <p className="auth__lead">
          {mode === 'forgot' ? '가입한 이메일을 적으면, 비밀번호를 다시 정하는 링크를 메일로 보내 드려요.'
            : mode === 'sent' ? <><strong className="auth__email">{sentTo}</strong>(으)로 가입돼 있다면 재설정 링크를 보냈어요. 링크는 30분 동안 한 번만 쓸 수 있어요. 메일이 안 보이면 스팸함도 확인해 주세요.</>
              : mode === 'reset' ? '앞으로 로그인할 새 비밀번호를 적어 주세요. 바꾸면 다른 기기의 로그인은 모두 풀려요.'
                : '섹션별로 나눠 쓰고, 키워드와 작성일로 다시 찾는 메모장이에요.'}
        </p>

        {mode === 'sent' ? (
          <div className="btn-row auth__form">
            <button type="button" className="btn btn--primary auth__submit" onClick={() => go('login')}>로그인으로 돌아가기</button>
          </div>
        ) : (
          <form key={mode} className="form auth__form" onSubmit={submit} noValidate>
            {askEmail && (
              <div className="field field--full">
                <label htmlFor="email">이메일</label>
                <input ref={emailRef} id="email" name="email" type="email" autoComplete="email" autoFocus={mode === 'forgot'}
                       aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} />
                {errors.email && <p id="email-error" className="field__error">{errors.email}</p>}
              </div>
            )}
            {askPassword && (
              <div className="field field--full">
                <label htmlFor="password">{mode === 'reset' ? '새 비밀번호' : '비밀번호'}</label>
                <input ref={passwordRef} id="password" name="password" type="password" autoFocus={mode === 'reset'}
                       autoComplete={newPassword ? 'new-password' : 'current-password'}
                       aria-invalid={!!errors.password}
                       aria-describedby={errors.password ? 'password-error' : newPassword ? 'password-hint' : undefined} />
                {errors.password
                  ? <p id="password-error" className="field__error">{errors.password}</p>
                  : newPassword && <p id="password-hint" className="field__hint">{PASSWORD_HINT}</p>}
              </div>
            )}
            {mode === 'reset' && (
              <div className="field field--full">
                <label htmlFor="confirm">새 비밀번호 한 번 더</label>
                <input ref={confirmRef} id="confirm" name="confirm" type="password" autoComplete="new-password"
                       aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? 'confirm-error' : undefined} />
                {errors.confirm && <p id="confirm-error" className="field__error">{errors.confirm}</p>}
              </div>
            )}
            {mode === 'login' && (
              <p className="auth__forgot">
                <button type="button" className="textbtn" onClick={() => go('forgot')}>비밀번호를 잊었어요</button>
              </p>
            )}
            <div className="btn-row">
              <button className="btn btn--primary auth__submit" type="submit" disabled={busy}>{SUBMIT[mode]}</button>
            </div>
            <p className="form__status" role="status">{status}</p>
          </form>
        )}

        <p className="auth__switch">
          {mode === 'login' ? (
            <>처음 쓰시나요?{' '}<button type="button" className="textbtn" onClick={() => go('signup')}>계정 만들기</button></>
          ) : mode === 'reset' ? (
            <>링크가 만료됐나요?{' '}<button type="button" className="textbtn" onClick={() => go('forgot')}>링크 다시 받기</button></>
          ) : mode !== 'sent' && (
            <>{mode === 'signup' ? '이미 계정이 있나요?' : '비밀번호가 생각났나요?'}{' '}
              <button type="button" className="textbtn" onClick={() => go('login')}>로그인하기</button></>
          )}
        </p>
      </div>
    </main>
  )
}
