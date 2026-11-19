import { useRef, useState } from 'react'
import { ApiError } from './api'
import { CAPTCHA_SITE_KEY } from './supabase'
import Turnstile from './Turnstile'

/**
 * 가입, 로그인, 패스워드 찾기에 붙는 보이지 않는 캡차(Cloudflare Turnstile Invisible).
 * 화면에는 아무것도 보이지 않고, Cloudflare가 뒤에서 사람인지 확인해요.
 * 토큰은 한 번만 쓸 수 있어서, take()로 꺼내면 바로 새 토큰을 받기 시작해요.
 */
export function useCaptcha() {
  const token = useRef<string | null>(null)
  const waiters = useRef<((t: string) => void)[]>([])
  const [round, setRound] = useState(0)

  function onToken(t: string | null) {
    token.current = t
    if (t) waiters.current.splice(0).forEach(resolve => resolve(t))
  }

  return {
    widget: <Turnstile key={round} siteKey={CAPTCHA_SITE_KEY} onToken={onToken} />,
    /** 토큰이 생길 때까지 잠깐(최대 10초) 기다렸다가 꺼내요. */
    async take(): Promise<string> {
      const t = token.current ?? await new Promise<string | null>(resolve => {
        waiters.current.push(resolve)
        window.setTimeout(() => resolve(null), 10_000)
      })
      if (!t) throw new ApiError(400, '로봇이 아닌지 확인하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.')
      token.current = null
      setRound(r => r + 1)
      return t
    },
  }
}
