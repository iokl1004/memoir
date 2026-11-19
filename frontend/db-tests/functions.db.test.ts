import { describe, expect, it } from 'vitest'
import { admin, anon, CAPTCHA, newUser, ok, PASSWORD, URL } from './helpers'

const png = (size: number) => {
  const b = new Uint8Array(size)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Blob([b], { type: 'image/png' })
}

async function upload(db: Awaited<ReturnType<typeof newUser>>['db'], file: Blob) {
  const form = new FormData()
  form.append('file', file, 'a.png')
  return db.functions.invoke<{ id: number; url: string }>('upload-image', { body: form })
}

async function errorOf(r: { error: unknown }): Promise<{ status: number; message: string }> {
  const res = (r.error as { context?: Response }).context
  if (!res) throw new Error('오류가 아니에요')
  return { status: res.status, message: (await res.json()).message }
}

describe('그림', () => {
  it('올린 그림은 주인만 볼 수 있고, 메모에 묶이면 청소되지 않는다', async () => {
    const me = await newUser()
    const other = await newUser()
    const { data } = await upload(me.db, png(1000))
    expect(data?.url).toBe(`/img/${data?.id}`)
    const path = `${me.id}/${data!.id}`

    expect((await me.db.storage.from('images').createSignedUrl(path, 60)).error).toBeNull()
    expect((await other.db.storage.from('images').createSignedUrl(path, 60)).error).not.toBeNull()

    const memo = await ok<{ id: number }>(me.db.rpc('save_memo', {
      p_id: null, p_section_id: null, p_title: '그림', p_html: `<p><img src="/img/${data!.id}"></p>`, p_text: '' }))
    // 남이 내 그림 번호를 본문에 넣어도 자기 메모에 묶이지 않아요.
    await ok(other.db.rpc('save_memo', { p_id: null, p_section_id: null, p_title: 'x', p_html: `<img src="/img/${data!.id}">`, p_text: '' }))
    const rows = await ok<{ memo_id: number }[]>(me.db.from('memo_images').select('memo_id'))
    expect(rows).toEqual([{ memo_id: memo.id }])
    expect(await ok<number>(me.db.rpc('image_usage'))).toBe(1000)
  })

  it('그림이 아니면 받지 않고, 저장 공간을 넘으면 받지 않는다', async () => {
    const { db } = await newUser()
    expect(await errorOf(await upload(db, new Blob(['<script>'], { type: 'image/png' }))))
      .toEqual({ status: 415, message: 'PNG, JPEG, GIF, WebP 그림만 올릴 수 있어요.' })
    let last = 201
    for (let i = 0; i < 12 && last === 201; i++) {
      const r = await upload(db, png(4.9 * 1024 * 1024))
      last = r.error ? (await errorOf(r)).status : 201
    }
    expect(last).toBe(413)
  }, 60_000)

  it('하루 지난 떼어 둔 그림은 청소 함수가 파일까지 지운다', async () => {
    const me = await newUser()
    const { data } = await upload(me.db, png(500))
    const fresh = (await upload(me.db, png(500))).data!
    await ok(admin.from('memo_images').update({ detached_at: '2000-01-01T00:00:00Z' }).eq('id', data!.id))

    const denied = await fetch(`${URL}/functions/v1/cleanup-images`, { method: 'POST' })
    expect(denied.status).toBe(401)
    const res = await fetch(`${URL}/functions/v1/cleanup-images`, {
      method: 'POST', headers: { 'x-cleanup-secret': 'local-cleanup-secret' } })
    expect(res.status).toBe(200)
    const ids = (await ok<{ id: number }[]>(me.db.from('memo_images').select('id'))).map(r => r.id)
    expect(ids).toEqual([fresh.id])
    const files = await ok(admin.storage.from('images').list(me.id))
    expect(files.map(f => f.name)).toEqual([String(fresh.id)])
  })
})

describe('계정', () => {
  it('캡차 없이는 가입할 수 없다', async () => {
    const { error } = await anon().auth.signUp({ email: `n${Date.now()}@test.local`, password: PASSWORD })
    expect(error?.code).toBe('captcha_failed')
  })

  it('패스워드 변경은 현재 패스워드가 맞아야 한다', async () => {
    const { db, email } = await newUser()
    const wrong = await db.auth.updateUser({ password: 'new-pass-456!', current_password: 'wrong-pass-1!' })
    expect(wrong.error).not.toBeNull()
    expect((await db.auth.updateUser({ password: 'new-pass-456!', current_password: PASSWORD })).error).toBeNull()
    const login = await anon().auth.signInWithPassword({ email, password: 'new-pass-456!', options: { captchaToken: CAPTCHA } })
    expect(login.error).toBeNull()
  })

  it('계정을 지우면 메모와 그림 파일까지 지워진다', async () => {
    const me = await newUser()
    await upload(me.db, png(500))
    await ok(me.db.rpc('save_memo', { p_id: null, p_section_id: null, p_title: 'x', p_html: null, p_text: '' }))

    const wrong = await me.db.functions.invoke('delete-account', { body: { password: 'nope-nope-1' } })
    expect(await errorOf(wrong)).toEqual({ status: 400, message: '패스워드가 올바르지 않아요.' })
    const done = await me.db.functions.invoke('delete-account', { body: { password: PASSWORD } })
    expect(done.error).toBeNull()

    expect((await admin.auth.admin.getUserById(me.id)).data.user).toBeNull()
    expect(await ok(admin.storage.from('images').list(me.id))).toEqual([])
    expect(await ok<unknown[]>(admin.from('memos').select('id').eq('user_id', me.id))).toEqual([])
    expect(await ok<unknown[]>(admin.from('sections').select('id').eq('user_id', me.id))).toEqual([])
  })
})
