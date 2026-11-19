import { useState } from 'react'
import { CAPTCHA_SITE_KEY } from './supabase'
import Turnstile from './Turnstile'

/**
 * 가입, 로그인, 패스워드 찾기에 붙는 캡차(Cloudflare Turnstile). 대부분 누르지 않아도 저절로 풀려요.
 * 토큰은 한 번만 쓸 수 있어서, 요청을 보낸 뒤에는 reset()으로 새로 풀게 해요.
 */
export function useCaptcha() {
  const [token, setToken] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  return {
    /** 아직 풀지 않았으면 true */
    missing: token === null,
    token: token ?? undefined,
    widget: <Turnstile key={round} siteKey={CAPTCHA_SITE_KEY} onToken={setToken} />,
    reset() {
      setToken(null)
      setRound(r => r + 1)
    },
  }
}
