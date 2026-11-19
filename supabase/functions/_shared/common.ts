import { createClient, type User } from 'npm:@supabase/supabase-js@2.119.1'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** 관리자 키 클라이언트. RLS를 건너뛰니 주인 확인은 직접 해요. */
export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

/** 화면이 오류 문구를 그대로 보여줘요. */
export function fail(status: number, message: string): Response {
  return json({ message }, status)
}

/** 요청의 로그인 토큰을 Auth 서버에 확인받아요. 없거나 틀리면 null */
export async function currentUser(req: Request): Promise<User | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  return error ? null : data.user
}
