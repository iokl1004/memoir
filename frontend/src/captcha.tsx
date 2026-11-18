import { useState } from 'react'
import { ApiError } from './api'
import Turnstile from './Turnstile'

/**
 * 서버가 캡차를 요구하면(응답에 captchaRequired) 캡차를 보여주고, 푼 토큰을 들고 있어요.
 * 토큰은 한 번만 쓸 수 있어서, 요청을 보낸 뒤에는 reset()으로 새로 풀게 해요.
 */
export function useCaptcha() {
  const [siteKey, setSiteKey] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  return {
    /** 캡차를 보여주고 있는데 아직 풀지 않았으면 true */
    missing: siteKey !== null && token === null,
    token: token ?? undefined,
    widget: siteKey ? <Turnstile key={round} siteKey={siteKey} onToken={setToken} /> : null,
    /** 캡차를 요구하는 응답이면 캡차를 띄우고 true */
    handle(err: unknown): boolean {
      const data = err instanceof ApiError ? err.data : undefined
      if (data?.captchaRequired && typeof data.captchaSiteKey === 'string') {
        setSiteKey(data.captchaSiteKey)
        return true
      }
      return false
    },
    reset() {
      if (siteKey === null) return
      setToken(null)
      setRound(r => r + 1)
    },
  }
}
