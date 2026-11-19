// 어느 메모에도 없는 채로 하루가 지난 그림을 지워요. GitHub Actions가 매일 불러요.
// 파일은 Storage API로만 지울 수 있어서(SQL로 지우면 파일이 남아요) 이 함수가 해요.
import { admin, fail, json } from '../_shared/common.ts'

const BATCH = 1000

Deno.serve(async req => {
  const secret = Deno.env.get('CLEANUP_SECRET')
  if (!secret || req.headers.get('x-cleanup-secret') !== secret) return fail(401, '권한이 없어요.')

  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
  let removed = 0
  for (;;) {
    // 메모를 지워서 떼어진 그림은 detached_at이 비어 있어 created_at으로 봐요.
    const { data: rows, error } = await admin.from('memo_images').select('id, user_id')
      .is('memo_id', null)
      .or(`detached_at.lt.${dayAgo},and(detached_at.is.null,created_at.lt.${dayAgo})`)
      .limit(BATCH)
    if (error) return fail(500, error.message)
    if (!rows.length) break
    const { error: removeError } = await admin.storage.from('images').remove(rows.map(r => `${r.user_id}/${r.id}`))
    if (removeError) return fail(500, removeError.message)
    const { error: deleteError } = await admin.from('memo_images').delete().in('id', rows.map(r => r.id))
    if (deleteError) return fail(500, deleteError.message)
    removed += rows.length
    if (rows.length < BATCH) break
  }
  return json({ removed })
})
