import { FunctionsHttpError, type AuthError, type PostgrestError } from '@supabase/supabase-js'
import { shrinkImage } from './images'
import { supabase } from './supabase'

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
}
export type MemoSummary = Omit<Memo, 'content' | 'contentHtml'> & { preview: string }
/** totalCapped이면 total은 "이 수 이상"이에요. */
export type MemoPage = { items: MemoSummary[]; page: number; total: number; totalCapped: boolean; hasNext: boolean }
export type MemoSort = 'CREATED_DESC' | 'CREATED_ASC' | 'UPDATED_DESC' | 'UPDATED_ASC' | 'TITLE_ASC' | 'TITLE_DESC' | 'CUSTOM'
export type MemoFilter = { sectionId?: number; q?: string; from?: string; to?: string }

/** 화면에 그대로 보여줄 문구와 HTTP 상태. 401이면 로그인 화면으로 돌아가요. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

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

type MemoRow = {
  id: number; section_id: number; title: string; content: string; content_html: string | null
  created_at: string; updated_at: string
}
const toMemo = (r: MemoRow): Memo => ({
  id: r.id, sectionId: r.section_id, title: r.title, content: r.content, contentHtml: r.content_html,
  createdAt: r.created_at, updatedAt: r.updated_at,
})
type SectionRow = { id: number; parent_id: number | null; name: string; is_default: boolean; memo_count?: number; created_at: string }
const toSection = (r: SectionRow): Section => ({
  id: r.id, parentId: r.parent_id, name: r.name, isDefault: r.is_default, memoCount: r.memo_count ?? 0, createdAt: r.created_at,
})

/** 지금 로그인한 사용자. 없으면 null */
export async function currentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getSession()
  const u = data.session?.user
  return u ? { id: u.id, email: u.email ?? '' } : null
}

type SaveBody = { sectionId: number; title: string; contentHtml: string; content: string }
const saveMemo = (id: number | null, m: SaveBody) =>
  db<MemoRow>(supabase.rpc('save_memo', {
    p_id: id, p_section_id: m.sectionId, p_title: m.title, p_html: m.contentHtml, p_text: m.content,
  })).then(toMemo)

export const api = {
  /** captchaToken: 가입, 로그인, 패스워드 찾기에는 항상 필요해요. */
  signup: async (email: string, password: string, captchaToken?: string): Promise<User> => {
    const { data } = await auth(supabase.auth.signUp({ email, password, options: { captchaToken } }))
    return { id: data.user!.id, email: data.user!.email ?? email }
  },
  login: async (email: string, password: string, captchaToken?: string): Promise<User> => {
    const { data } = await auth(supabase.auth.signInWithPassword({ email, password, options: { captchaToken } }))
    return { id: data.user!.id, email: data.user!.email ?? email }
  },
  logout: () => supabase.auth.signOut({ scope: 'local' }).then(() => undefined),
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
    await supabase.auth.signOut({ scope: 'local' })
  },
  /** 그림 저장 공간에서 쓴 바이트 수 */
  imageUsage: () => db<number>(supabase.rpc('image_usage')),

  sections: () => db<SectionRow[]>(supabase.rpc('list_sections')).then(rows => rows.map(toSection)),
  createSection: (name: string, parentId: number | null) =>
    db<SectionRow>(supabase.rpc('create_section', { p_name: name, p_parent_id: parentId })).then(toSection),
  renameSection: (id: number, name: string) =>
    db<SectionRow>(supabase.rpc('rename_section', { p_id: id, p_name: name })).then(toSection),
  deleteSection: (id: number) => db<void>(supabase.rpc('delete_section', { p_id: id })),
  /** parentId가 null이면 최상위, beforeId가 null이면 그 안의 맨 아래로 옮겨요. 하위 섹션과 메모는 함께 따라가요. */
  moveSection: (id: number, parentId: number | null, beforeId: number | null = null) =>
    db<SectionRow>(supabase.rpc('move_section', { p_id: id, p_parent_id: parentId, p_before_id: beforeId })).then(toSection),

  memos: (filter: MemoFilter, sort: MemoSort, page: number, size = 20) =>
    db<MemoPage>(supabase.rpc('search_memos', {
      p_section_id: filter.sectionId ?? null, p_q: filter.q || null, p_from: filter.from || null, p_to: filter.to || null,
      p_sort: sort, p_page: page, p_size: size,
    })),
  memo: (id: number) =>
    db<MemoRow>(supabase.from('memos').select('*').eq('id', id).single()).then(toMemo, err => {
      throw err instanceof ApiError && err.status === 404 ? new ApiError(404, '메모를 찾을 수 없어요.') : err
    }),
  createMemo: (m: SaveBody) => saveMemo(null, m),
  updateMemo: (id: number, m: SaveBody) => saveMemo(id, m),
  deleteMemo: (id: number) => db<void>(supabase.rpc('delete_memos', { p_ids: [id] })),
  /** 본문에 붙여넣은 그림을 줄여서 올려요. 돌려받은 url("/img/번호")을 본문에 저장해요. */
  uploadImage: async (file: Blob) => {
    const form = new FormData()
    form.append('file', await shrinkImage(file), 'image')
    return fn<{ id: number; url: string }>('upload-image', form)
  },
  /** 여러 메모를 한 섹션으로 옮겨요. 수정일도 바뀌어요. 하나라도 남의 메모면 아무것도 바뀌지 않아요. */
  moveMemos: (ids: number[], sectionId: number) => db<void>(supabase.rpc('move_memos', { p_ids: ids, p_section_id: sectionId })),
  /** 여러 메모를 한 번에 지워요. */
  deleteMemos: (ids: number[]) => db<void>(supabase.rpc('delete_memos', { p_ids: ids })),
  /** 끌어 놓은 자리의 위(afterId)와 아래(beforeId) 메모 */
  moveMemo: (id: number, afterId: number | null, beforeId: number | null) =>
    db<void>(supabase.rpc('move_memo', { p_id: id, p_after_id: afterId, p_before_id: beforeId })),
}
