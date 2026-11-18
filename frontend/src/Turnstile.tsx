import { useEffect, useRef, useState } from 'react'

/** Cloudflare Turnstile 스크립트가 만드는 전역 객체 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string
      remove: (id: string) => void
    }
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<void> | null = null

/** 캡차 스크립트는 캡차가 처음 필요할 때 한 번만 불러와요. (평소 로그인에는 외부 스크립트가 없어요) */
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => { loading = null; reject(new Error('turnstile')) }
    document.head.appendChild(script)
  })
  return loading
}

export default function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  const [failed, setFailed] = useState(false)
  useEffect(() => { onTokenRef.current = onToken })

  useEffect(() => {
    let id: string | undefined
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return
      id = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        language: 'ko',
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        callback: (token: string) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => onTokenRef.current(null),
      })
    }, () => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      if (id !== undefined) window.turnstile?.remove(id)
    }
  }, [siteKey])

  return (
    <div className="captcha">
      <p className="captcha__label">여러 번 틀려서, 로봇이 아닌지 확인할게요.</p>
      <div ref={ref} />
      {failed && <p className="field__error">확인 창을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.</p>}
    </div>
  )
}
