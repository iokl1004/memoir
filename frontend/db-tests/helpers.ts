import { execSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// 켜져 있는 로컬 Supabase(`npx supabase start`)에서 주소와 키를 읽어요. 키를 코드에 적지 않아요.
const local = Object.fromEntries(
  execSync('npx --yes supabase@3.2.0 status -o env', { cwd: '..', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').flatMap(line => {
      const m = line.match(/^(\w+)="?([^"]*)"?$/)
      return m ? [[m[1], m[2]]] : []
    }),
)
export const URL: string = local.API_URL
const PUBLISHABLE: string = local.PUBLISHABLE_KEY
const SECRET: string = local.SECRET_KEY
/** Turnstile 테스트 비밀 키는 이 가짜 토큰을 통과시켜요. */
export const CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX'
export const PASSWORD = 'test-pass-123!'

const options = { auth: { persistSession: false, autoRefreshToken: false } }
export const admin = createClient(URL, SECRET, options)

/** 새 사용자를 만들고 로그인한 클라이언트를 돌려줘요. */
export async function newUser(): Promise<{ db: SupabaseClient; id: string; email: string }> {
  const email = `t${crypto.randomUUID().slice(0, 12)}@test.local`
  const db = createClient(URL, PUBLISHABLE, options)
  const { data, error } = await db.auth.signUp({ email, password: PASSWORD, options: { captchaToken: CAPTCHA } })
  if (error || !data.user) throw error ?? new Error('가입 실패')
  return { db, id: data.user.id, email }
}

export function anon(): SupabaseClient {
  return createClient(URL, PUBLISHABLE, options)
}

/** rpc 결과에서 오류면 던지고, 아니면 data를 돌려줘요. */
export async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

export async function fails(p: PromiseLike<{ error: { message: string } | null }>): Promise<string> {
  const { error } = await p
  if (!error) throw new Error('실패해야 하는데 성공했어요')
  return error.message
}
