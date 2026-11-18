import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, type User } from './api'
import { useCaptcha } from './captcha'
import ThemeToggle from './ThemeToggle'

/** login·signup: 로그인과 가입, forgot: 패스워드 찾기(메일 보내기), sent: 메일을 보낸 뒤, reset: 메일 링크로 새 패스워드 정하기 */
type Mode = 'login' | 'signup' | 'forgot' | 'sent' | 'reset'
type Errors = { email?: string; password?: string; confirm?: string }

const PASSWORD_RULE = /^[\x21-\x7E]{8,64}$/
const PASSWORD_HINT = '공백 없이 영문, 숫자, 특수문자로 8~64자'
/** 서버가 같은 계정에 메일을 다시 보내기까지 기다리는 시간(PasswordResetService.RESEND_GAP)과 같아요. */
const RESEND_SECONDS = 60

const TITLES: Record<Mode, string> = {
  login: 'memoir에 로그인',
  signup: 'memoir 계정 만들기',
  forgot: '패스워드 찾기',
  sent: '메일을 확인해 주세요',
  reset: '새 패스워드 정하기',
}
const SUBMIT: Partial<Record<Mode, string>> = {
  login: '로그인하기', signup: '계정 만들기', forgot: '재설정 링크 보내기', reset: '패스워드 변경',
}
const BUSY: Partial<Record<Mode, string>> = {
  login: '로그인하는 중', signup: '가입하는 중', forgot: '링크를 보내는 중', reset: '패스워드를 변경하는 중',
}

export default function AuthScreen({ onLogin, resetToken }: {
  onLogin: (user: User) => void
  /** 메일 링크(?reset=...)로 들어오면 그 토큰. 새 패스워드 화면을 바로 보여줘요. */
  resetToken?: string
}) {
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login')
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState('')
  const [sentTo, setSentTo] = useState('')
  /** 이 시각(ms)이 지나야 같은 이메일로 다시 보낼 수 있어요. 그 전에 요청하면 서버가 조용히 건너뛰어서, 화면에서 남은 시간을 보여줘요. */
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))

  useEffect(() => {
    if (resendAt <= Date.now()) return
    const timer = window.setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= resendAt) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendAt])

  /** 재설정 메일을 보내고 1분 기다리기를 시작해요. 아직 기다리는 중인 같은 이메일이면 보내지 않아요. */
  async function sendResetMail(email: string) {
    if (email === sentTo && waitSeconds > 0) return false
    await api.requestPasswordReset(email)
    setSentTo(email)
    setResendAt(Date.now() + RESEND_SECONDS * 1000)
    setNow(Date.now())
    return true
  }

  async function resend() {
    setBusy(true)
    try {
      await sendResetMail(sentTo)
      setStatus('메일을 다시 보냈어요.')
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : '서버와 연결하지 못했어요.')
    }
    setBusy(false)
  }
  const [busy, setBusy] = useState(false)
  const captcha = useCaptcha()
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
    if (askPassword && !password) next.password = '패스워드를 적어 주세요.'
    else if (newPassword && !PASSWORD_RULE.test(password))
      next.password = '패스워드는 공백 없이 영문, 숫자, 특수문자로 8~64자여야 해요.'
    if (mode === 'reset' && !next.password && confirm !== password) next.confirm = '두 패스워드가 달라요. 같게 적어 주세요.'
    setErrors(next)
    const firstBad = next.email ? emailRef : next.password ? passwordRef : next.confirm ? confirmRef : null
    if (firstBad) {
      firstBad.current?.focus()
      setStatus(`확인할 칸이 ${Object.keys(next).length}개 있어요.`)
      return
    }
    if ((mode === 'login' || mode === 'signup') && captcha.missing) {
      setStatus('아래 확인 상자를 먼저 풀어 주세요.')
      return
    }

    setBusy(true)
    setStatus(BUSY[mode] ?? '')
    try {
      if (mode === 'forgot') {
        const sent = await sendResetMail(email)
        go('sent', sent ? '' : `조금 전에 보낸 메일이 있어요. ${waitSeconds}초 뒤에 다시 보낼 수 있어요.`)
      } else if (mode === 'reset') {
        await api.confirmPasswordReset(resetToken ?? '', password)
        go('login', '패스워드를 변경했어요. 새 패스워드로 로그인해 주세요.')
      } else {
        const token = captcha.token
        captcha.reset() // 캡차 토큰은 한 번만 쓸 수 있어요.
        if (mode === 'signup') await api.signup(email, password, token)
        onLogin(await api.login(email, password, mode === 'login' ? token : undefined))
      }
    } catch (err) {
      captcha.handle(err)
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
          {mode === 'forgot' ? '가입한 이메일을 적으면, 패스워드를 다시 정하는 링크를 메일로 보내 드려요.'
            : mode === 'sent' ? <><strong className="auth__email">{sentTo}</strong>(으)로 가입돼 있다면 재설정 링크를 보냈어요. 링크는 30분 동안 한 번만 쓸 수 있어요. 메일이 안 보이면 스팸함도 확인해 주세요. 다시 보내기는 1분에 한 번 할 수 있어요.</>
              : mode === 'reset' ? '앞으로 로그인할 새 패스워드를 적어 주세요. 바꾸면 다른 기기의 로그인은 모두 풀려요.'
                : '섹션별로 나눠 쓰고, 키워드와 작성일로 다시 찾는 메모장이에요.'}
        </p>

        {mode === 'sent' ? (
          <div className="auth__form auth__sent">
            <button type="button" className="btn btn--primary auth__submit" onClick={() => go('login')}>로그인으로 돌아가기</button>
            <button type="button" className="btn btn--secondary auth__submit" onClick={resend}
                    disabled={busy || waitSeconds > 0} aria-describedby="resend-wait">
              메일 다시 보내기
            </button>
            {/* 1초마다 바뀌는 숫자는 화면 낭독기가 읽지 않게 하고, 다시 보낼 수 있게 됐을 때만 알려요. */}
            <p id="resend-wait" className="field__hint auth__wait">
              {waitSeconds > 0 ? <span aria-hidden="true">{waitSeconds}초 뒤에 다시 보낼 수 있어요.</span> : '이제 다시 보낼 수 있어요.'}
            </p>
            <p className="form__status" role="status">{status}</p>
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
                <label htmlFor="password">{mode === 'reset' ? '새 패스워드' : '패스워드'}</label>
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
                <label htmlFor="confirm">새 패스워드 확인</label>
                <input ref={confirmRef} id="confirm" name="confirm" type="password" autoComplete="new-password"
                       aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? 'confirm-error' : undefined} />
                {errors.confirm && <p id="confirm-error" className="field__error">{errors.confirm}</p>}
              </div>
            )}
            {(mode === 'login' || mode === 'signup') && captcha.widget}
            {mode === 'login' && (
              <p className="auth__forgot">
                <button type="button" className="textbtn" onClick={() => go('forgot')}>패스워드를 잊었어요</button>
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
            <>{mode === 'signup' ? '이미 계정이 있나요?' : '패스워드가 생각났나요?'}{' '}
              <button type="button" className="textbtn" onClick={() => go('login')}>로그인하기</button></>
          )}
        </p>
      </div>
    </main>
  )
}
