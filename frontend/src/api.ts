import { FunctionsHttpError, isAuthRetryableFetchError, type AuthError, type PostgrestError } from '@supabase/supabase-js'
import { ApiError, type MemoRow, type Remote, type SectionRow } from './offline'

/** 메모마다 본문 없이 바뀌었는지 알 만큼만. 수정일이 그대로여도 순서·섹션·고정·휴지통은 바뀔 수 있어요. */
type MemoIndexRow = Pick<MemoRow, 'id' | 'sectionId' | 'position' | 'updatedAt' | 'pinned' | 'deletedAt'>
import { authStorage, supabase } from './supabase'

export { ApiError }

export type User = { id: string; email: string }
/** memoCount는 이 섹션에 바로 쓴 메모 수예요. 하위까지 합친 수는 sectionTree.ts가 계산해요. */
export type Section = {
  id: number
  parentId: number | null
  name: string
  isDefault: boolean
  memoCount: number
  createdAt: string
}
export type Memo = {
  id: number
  sectionId: number
  title: string
  /** 본문의 글자만 (검색·미리보기용) */
  content: string
  /** 편집기 본문(글자와 그림). 글자만 있는 메모는 null이라 content를 문단으로 바꿔 보여줘요. */
  contentHtml: string | null
  createdAt: string
  updatedAt: string
  /** 목록 맨 위에 고정 */
  pinned: boolean
  /** 휴지통에 넣은 때. null이면 휴지통에 없어요. */
  deletedAt: string | null
}
export type MemoSummary = Omit<Memo, 'content' | 'contentHtml'> & { preview: string }
/** totalCapped이면 total은 "이 수 이상"이에요. */
export type MemoPage = { items: MemoSummary[]; page: number; total: number; totalCapped: boolean; hasNext: boolean }
export type MemoSort = 'CREATED_DESC' | 'CREATED_ASC' | 'UPDATED_DESC' | 'UPDATED_ASC' | 'TITLE_ASC' | 'TITLE_DESC' | 'CUSTOM'
export type MemoFilter = { sectionId?: number; q?: string; from?: string; to?: string }


const CONNECTION = '서버와 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.'

/** Supabase Auth 오류 코드 → 화면 문구 */
const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: '이메일 또는 패스워드가 올바르지 않아요.',
  user_already_exists: '이미 가입된 이메일이에요.',
  email_exists: '이미 가입된 이메일이에요.',
  weak_password: '패스워드는 공백 없이 영문, 숫자, 특수문자로 8~64자여야 해요.',
  same_password: '현재 패스워드와 다른 패스워드를 적어 주세요.',
  current_password_invalid: '현재 패스워드가 올바르지 않아요.',
  captcha_failed: '로봇이 아닌지 확인하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.',
  over_email_send_rate_limit: '메일을 너무 자주 요청했어요. 1분 뒤에 다시 시도해 주세요.',
  over_request_rate_limit: '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.',
  otp_expired: '링크가 만료됐거나 이미 썼어요. 링크를 다시 받아 주세요.',
  session_not_found: '로그인이 필요해요.',
  email_address_invalid: '이메일을 다시 확인해 주세요.',
}

function authError(error: AuthError): ApiError {
  const message = (error.code && AUTH_MESSAGES[error.code]) || CONNECTION
  return new ApiError(error.code === 'session_not_found' ? 401 : error.status ?? 500, message)
}

/** DB 함수가 낸 오류(P0001)는 문구를 그대로 보여주고, 나머지는 상태에 맞는 문구를 써요. */
function dbError(error: PostgrestError, status: number): ApiError {
  if (error.code === 'P0001') return new ApiError(400, error.message)
  if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') return new ApiError(401, '로그인이 필요해요.')
  if (error.code === 'PGRST116') return new ApiError(404, '찾을 수 없어요.')
  return new ApiError(status || 500, CONNECTION)
}

async function db<T>(p: PromiseLike<{ data: unknown; error: PostgrestError | null; status: number }>): Promise<T> {
  const { data, error, status } = await p
  if (error) throw dbError(error, status)
  return data as T
}

async function auth<T extends { error: AuthError | null }>(p: Promise<T>): Promise<T> {
  const result = await p
  if (result.error) throw authError(result.error)
  return result
}

async function fn<T>(name: string, body: FormData | Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response
    const message = await res.json().then(b => b.message as string | undefined, () => undefined)
    throw new ApiError(res.status, message ?? CONNECTION)
  }
  if (error) throw new ApiError(500, CONNECTION)
  return data as T
}

type DbMemo = {
  id: number; section_id: number; position: number; title: string; content: string; content_html: string | null
  created_at: string; updated_at: string; pinned: boolean; deleted_at: string | null
}
const toRow = (r: DbMemo): MemoRow => ({
  id: r.id, sectionId: r.section_id, position: r.position, title: r.title, content: r.content, contentHtml: r.content_html,
  createdAt: r.created_at, updatedAt: r.updated_at, pinned: r.pinned, deletedAt: r.deleted_at,
})
type DbSection = { id: number; parent_id: number | null; name: string; is_default: boolean; position: number; created_at: string }
const toSection = (r: DbSection): SectionRow => ({
  id: r.id, parentId: r.parent_id, name: r.name, isDefault: r.is_default, position: r.position, createdAt: r.created_at,
})

/** 오프라인에서 다시 열 때 쓰는 마지막 로그인 사용자. 로그인 정보와 같은 곳(자동 로그인에 따라)에 둬요. */
const USER_KEY = 'memoir-user'
function remember(u: User): User {
  authStorage.setItem(USER_KEY, JSON.stringify(u))
  return u
}

/** 지금 로그인한 사용자. 없으면 null */
export async function currentUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getSession()
  const u = data.session?.user
  if (u) return remember({ id: u.id, email: u.email ?? '' })
  // 인터넷이 없어서 로그인을 새로 고치지 못했을 뿐이면, 로그인은 그대로 있어요. 연결되면 supabase가 다시 고쳐요.
  if (error && isAuthRetryableFetchError(error)) {
    try { return JSON.parse(authStorage.getItem(USER_KEY) ?? 'null') } catch { return null }
  }
  return null
}

const chunks = <T,>(list: T[], size = 100) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

/** 서버를 직접 부르는 일. 화면은 store.ts를 거쳐서 써요(오프라인 편집). */
export const remote: Remote & {
  memoIndex(): Promise<MemoIndexRow[]>
  memosByIds(ids: number[]): Promise<MemoRow[]>
  imageBlob(id: number): Promise<Blob>
} = {
  createSection: (name, parentId) =>
    db<DbSection>(supabase.rpc('create_section', { p_name: name, p_parent_id: parentId })).then(toSection),
  renameSection: (id, name) => db<void>(supabase.rpc('rename_section', { p_id: id, p_name: name })).then(() => undefined),
  deleteSection: id => db<void>(supabase.rpc('delete_section', { p_id: id })),
  moveSection: (id, parentId, beforeId) =>
    db<void>(supabase.rpc('move_section', { p_id: id, p_parent_id: parentId, p_before_id: beforeId })).then(() => undefined),
  sections: () =>
    db<DbSection[]>(supabase.from('sections').select('id, parent_id, name, is_default, position, created_at')).then(rows => rows.map(toSection)),
  saveMemo: (id, m) => db<DbMemo>(supabase.rpc('save_memo', {
    p_id: id, p_section_id: m.sectionId, p_title: m.title, p_html: m.contentHtml, p_text: m.content,
  })).then(toRow),
  memoStamps: async ids => {
    const rows = (await Promise.all(chunks(ids).map(part =>
      db<{ id: number; updated_at: string }[]>(supabase.from('memos').select('id, updated_at').in('id', part))))).flat()
    return new Map(rows.map(r => [r.id, r.updated_at]))
  },
  memo: id => db<DbMemo[]>(supabase.from('memos').select('*').eq('id', id)).then(rows => (rows[0] ? toRow(rows[0]) : null)),
  moveMemos: (ids, sectionId) => db<void>(supabase.rpc('move_memos', { p_ids: ids, p_section_id: sectionId })),
  deleteMemos: ids => db<void>(supabase.rpc('delete_memos', { p_ids: ids })),
  restoreMemos: ids => db<void>(supabase.rpc('restore_memos', { p_ids: ids })),
  purgeMemos: ids => db<void>(supabase.rpc('purge_memos', { p_ids: ids })),
  pinMemos: (ids, pinned) => db<void>(supabase.rpc('pin_memos', { p_ids: ids, p_pinned: pinned })),
  moveMemo: (id, afterId, beforeId) => db<void>(supabase.rpc('move_memo', { p_id: id, p_after_id: afterId, p_before_id: beforeId })),
  /** 그림은 화면이 미리 줄여서 줘요(images.ts shrinkImage). */
  uploadImage: async blob => {
    const form = new FormData()
    form.append('file', blob, 'image')
    return (await fn<{ id: number }>('upload-image', form)).id
  },

  /** 모든 메모의 번호와 수정 시각. 한 번에 1,000줄까지 와서 나눠 받아요. */
  memoIndex: async () => {
    const all: MemoIndexRow[] = []
    for (let from = 0; ; from += 1000) {
      const rows = await db<{ id: number; section_id: number; position: number; updated_at: string; pinned: boolean; deleted_at: string | null }[]>(
        supabase.from('memos').select('id, section_id, position, updated_at, pinned, deleted_at').order('id').range(from, from + 999))
      all.push(...rows.map(r => ({
        id: r.id, sectionId: r.section_id, position: r.position, updatedAt: r.updated_at, pinned: r.pinned, deletedAt: r.deleted_at,
      })))
      if (rows.length < 1000) return all
    }
  },
  memosByIds: async ids =>
    (await Promise.all(chunks(ids).map(part => db<DbMemo[]>(supabase.from('memos').select('*').in('id', part))))).flat().map(toRow),
  /** 비공개 Storage의 그림 파일. 잠깐 쓰는 서명 주소로 받아요. */
  imageBlob: async id => {
    const userId = (await supabase.auth.getSession()).data.session?.user.id
    const { data, error } = await supabase.storage.from('images').createSignedUrl(`${userId}/${id}`, 60)
    if (error || !data) throw new ApiError(404, '그림을 찾을 수 없어요.')
    const res = await fetch(data.signedUrl)
    if (!res.ok) throw new ApiError(res.status, '그림을 받지 못했어요.')
    return res.blob()
  },
}

export const api = {
  /** captchaToken: 가입, 로그인, 패스워드 찾기에는 항상 필요해요. */
  signup: async (email: string, password: string, captchaToken?: string): Promise<User> => {
    const { data } = await auth(supabase.auth.signUp({ email, password, options: { captchaToken } }))
    return remember({ id: data.user!.id, email: data.user!.email ?? email })
  },
  login: async (email: string, password: string, captchaToken?: string): Promise<User> => {
    const { data } = await auth(supabase.auth.signInWithPassword({ email, password, options: { captchaToken } }))
    return remember({ id: data.user!.id, email: data.user!.email ?? email })
  },
  logout: () => { authStorage.removeItem(USER_KEY); return supabase.auth.signOut({ scope: 'local' }).then(() => undefined) },
  /** 패스워드 찾기 메일. 가입하지 않은 이메일이어도 똑같이 성공해요(가입 여부를 숨겨요). */
  requestPasswordReset: (email: string, captchaToken?: string) =>
    auth(supabase.auth.resetPasswordForEmail(email, { captchaToken })).then(() => undefined),
  /** 메일 링크의 토큰으로 새 패스워드를 정하고, 모든 기기의 로그인을 풀어요. */
  confirmPasswordReset: async (tokenHash: string, password: string) => {
    await auth(supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash }))
    await auth(supabase.auth.updateUser({ password }))
    await supabase.auth.signOut({ scope: 'global' })
  },
  /** 로그인한 상태에서 패스워드 변경. 다른 기기의 로그인은 끊겨요. */
  changePassword: async (currentPassword: string, newPassword: string) => {
    await auth(supabase.auth.updateUser({ password: newPassword, current_password: currentPassword }))
    await supabase.auth.signOut({ scope: 'others' })
  },
  /** 계정과 모든 메모, 그림을 지우고 로그아웃해요. */
  deleteAccount: async (password: string) => {
    await fn('delete-account', { password })
    authStorage.removeItem(USER_KEY)
    await supabase.auth.signOut({ scope: 'local' })
  },
  /** 그림 저장 공간에서 쓴 바이트 수 */
  imageUsage: () => db<number>(supabase.rpc('image_usage')),
}
