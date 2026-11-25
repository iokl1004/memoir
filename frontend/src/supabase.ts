import { createClient } from '@supabase/supabase-js'

/** 자동 로그인을 끄면 '0'. 없으면 켠 것으로 봐요(예전처럼 로그인이 남아 있게). */
export const AUTO_LOGIN_KEY = 'memoir-auto-login'
/** 아이디 저장을 켜면 이메일을 여기에 남겨요. */
export const SAVED_EMAIL_KEY = 'memoir-email'
const autoLogin = () => localStorage.getItem(AUTO_LOGIN_KEY) !== '0'

/** 자동 로그인을 끄면 로그인 정보를 sessionStorage에 둬서, 브라우저(휴대폰은 그 탭)를 닫으면 로그아웃돼요. */
const authStorage = {
  getItem: (key: string) => (autoLogin() ? localStorage : sessionStorage).getItem(key),
  setItem: (key: string, value: string) => (autoLogin() ? localStorage : sessionStorage).setItem(key, value),
  removeItem: (key: string) => { localStorage.removeItem(key); sessionStorage.removeItem(key) },
}

// 값이 없으면 로컬 Supabase(`npx supabase start`)의 기본값을 써요. 누구나 아는 개발용 값이에요.
// 배포 때는 Vercel 환경 변수 VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY를 넣어요. (publishable 키는 공개돼도 되는 키예요)
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  { auth: { storage: authStorage } },
)

/** Cloudflare Turnstile 사이트 키(Invisible 위젯). 없으면 보이지 않는 테스트 키(항상 통과)예요. */
export const CAPTCHA_SITE_KEY: string = import.meta.env.VITE_CAPTCHA_SITE_KEY ?? '1x00000000000000000000BB'
