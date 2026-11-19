// 계정과 모든 메모, 그림을 지워요. 패스워드를 한 번 더 확인해요.
// 그림 파일이 남아 있으면 Auth가 사용자를 지우지 못해서, 파일부터 지우고 사용자를 지워요(표는 연쇄로 지워져요).
import { admin, cors, currentUser, fail, json } from '../_shared/common.ts'

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, '지원하지 않는 요청이에요.')
  const user = await currentUser(req)
  if (!user) return fail(401, '로그인이 필요해요.')

  const { password } = await req.json().catch(() => ({})) as { password?: unknown }
  if (typeof password !== 'string' || !password) return fail(400, '패스워드를 입력해 주세요.')
  const { data: matches, error } = await admin.rpc('check_password', { p_user: user.id, p_password: password })
  if (error) return fail(500, '패스워드를 확인하지 못했어요.')
  if (!matches) return fail(400, '패스워드가 올바르지 않아요.')

  const bucket = admin.storage.from('images')
  for (;;) {
    const { data: files, error: listError } = await bucket.list(user.id, { limit: 1000 })
    if (listError) return fail(500, '그림을 지우지 못했어요.')
    if (!files.length) break
    const { error: removeError } = await bucket.remove(files.map(f => `${user.id}/${f.name}`))
    if (removeError) return fail(500, '그림을 지우지 못했어요.')
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) return fail(500, '계정을 지우지 못했어요.')
  return json({ ok: true })
})
