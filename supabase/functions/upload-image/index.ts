// 본문에 붙여넣은 그림을 받아 Storage에 저장해요. 화면이 미리 줄여서 보내요(긴 변 2000px).
// 브라우저는 믿을 수 없어서, 파일 종류와 크기, 한 사람의 저장 공간은 여기서 다시 확인해요.
import { admin, cors, currentUser, fail, json } from '../_shared/common.ts'

const MAX_BYTES = 5 * 1024 * 1024
const QUOTA_MB = Number(Deno.env.get('IMAGE_QUOTA_MB') ?? '50')

/** 파일 앞부분으로 실제 종류를 알아내요. 이름이나 브라우저가 보낸 종류는 믿지 않아요. */
export function sniff(b: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, '지원하지 않는 요청이에요.')
  const user = await currentUser(req)
  if (!user) return fail(401, '로그인이 필요해요.')

  const file = (await req.formData().catch(() => null))?.get('file')
  if (!(file instanceof File)) return fail(400, '그림 파일을 보내 주세요.')
  if (file.size > MAX_BYTES) return fail(413, '그림은 5MB까지 올릴 수 있어요.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniff(bytes)
  if (!type) return fail(415, 'PNG, JPEG, GIF, WebP 그림만 올릴 수 있어요.')

  // shortcut: 같은 사람이 동시에 여러 장을 올리면 합계 확인을 함께 통과할 수 있어요. 한도를 조금 넘는 정도라 괜찮아요.
  const { data: used, error: usedError } = await admin.from('memo_images').select('byte_size').eq('user_id', user.id)
  if (usedError) return fail(500, '저장 공간을 확인하지 못했어요.')
  const usedBytes = used.reduce((sum, r) => sum + r.byte_size, 0)
  if (usedBytes + bytes.length > QUOTA_MB * 1024 * 1024) {
    return fail(413, `그림 저장 공간(${QUOTA_MB}MB)을 다 썼어요. 그림이 든 메모를 지우면 공간이 생겨요.`)
  }

  // 메모에 묶이기 전까지는 "떼어 둔" 그림이에요. 메모를 저장하지 않으면 하루 뒤 청소돼요.
  const { data: row, error } = await admin.from('memo_images')
    .insert({ user_id: user.id, content_type: type, byte_size: bytes.length, detached_at: new Date().toISOString() })
    .select('id').single()
  if (error) return fail(500, '그림을 저장하지 못했어요.')

  const { error: uploadError } = await admin.storage.from('images')
    .upload(`${user.id}/${row.id}`, bytes, { contentType: type, cacheControl: '31536000' })
  if (uploadError) {
    await admin.from('memo_images').delete().eq('id', row.id)
    return fail(500, '그림을 저장하지 못했어요.')
  }
  return json({ id: row.id, url: `/img/${row.id}` }, 201)
})
