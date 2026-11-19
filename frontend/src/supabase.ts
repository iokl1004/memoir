import { createClient } from '@supabase/supabase-js'

// 값이 없으면 로컬 Supabase(`npx supabase start`)의 기본값을 써요. 누구나 아는 개발용 값이에요.
// 배포 때는 Vercel 환경 변수 VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY를 넣어요. (publishable 키는 공개돼도 되는 키예요)
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
)

/** Cloudflare Turnstile 사이트 키. 없으면 테스트 키(항상 통과, "테스트 전용" 문구)예요. */
export const CAPTCHA_SITE_KEY: string = import.meta.env.VITE_CAPTCHA_SITE_KEY ?? '1x00000000000000000000AA'
