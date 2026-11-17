export type User = { id: number; email: string }
/** memoCount는 이 섹션에 바로 쓴 메모 수예요. 하위까지 합친 수는 sectionTree.ts가 계산해요. */
export type Section = { id: number; parentId: number | null; name: string; isDefault: boolean; memoCount: number }
export type Memo = {
  id: number
  sectionId: number
  title: string
  content: string
  createdAt: string
  updatedAt: string
}
export type MemoSummary = Omit<Memo, 'content'> & { preview: string }
/** totalCapped이면 total은 "이 수 이상"이에요. */
export type MemoPage = { items: MemoSummary[]; page: number; total: number; totalCapped: boolean; hasNext: boolean }
export type MemoSort = 'CREATED_DESC' | 'CREATED_ASC' | 'UPDATED_DESC' | 'UPDATED_ASC' | 'TITLE_ASC' | 'TITLE_DESC' | 'CUSTOM'
export type MemoFilter = { sectionId?: number; q?: string; from?: string; to?: string }

/** 서버가 보낸 ProblemDetail의 status와 detail을 그대로 들고 있어요. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function xsrfToken(): string {
  return document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)?.[1] ?? ''
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      // 세션 쿠키 방식이라 CSRF 토큰을 헤더로 같이 보내야 POST, PATCH, PUT, DELETE가 통과해요.
      'X-XSRF-TOKEN': decodeURIComponent(xsrfToken()),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, data?.detail && data.detail !== 'Invalid request content.'
      ? data.detail
      : messageFor(res.status))
  }
  return data as T
}

function messageFor(status: number): string {
  if (status === 400) return '입력한 내용을 다시 확인해 주세요.'
  if (status === 401) return '로그인이 필요해요.'
  if (status === 403) return '요청이 거부됐어요. 새로고침한 뒤 다시 시도해 주세요.'
  if (status === 404) return '찾을 수 없어요.'
  return '서버와 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  return q.toString()
}

export const api = {
  me: () => request<User>('GET', '/api/auth/me'),
  signup: (email: string, password: string) => request<User>('POST', '/api/auth/signup', { email, password }),
  login: (email: string, password: string) => request<User>('POST', '/api/auth/login', { email, password }),
  logout: () => request<void>('POST', '/api/auth/logout'),

  sections: () => request<Section[]>('GET', '/api/sections'),
  createSection: (name: string, parentId: number | null) => request<Section>('POST', '/api/sections', { name, parentId }),
  renameSection: (id: number, name: string) => request<Section>('PATCH', `/api/sections/${id}`, { name }),
  deleteSection: (id: number) => request<void>('DELETE', `/api/sections/${id}`),

  memos: (filter: MemoFilter, sort: MemoSort, page: number) =>
    request<MemoPage>('GET', `/api/memos?${query({ ...filter, sort, page })}`),
  memo: (id: number) => request<Memo>('GET', `/api/memos/${id}`),
  createMemo: (m: { sectionId: number; title: string; content: string }) => request<Memo>('POST', '/api/memos', m),
  updateMemo: (id: number, m: { sectionId: number; title: string; content: string }) =>
    request<Memo>('PATCH', `/api/memos/${id}`, m),
  deleteMemo: (id: number) => request<void>('DELETE', `/api/memos/${id}`),
  /** 끌어 놓은 자리의 위(afterId)와 아래(beforeId) 메모 */
  moveMemo: (id: number, afterId: number | null, beforeId: number | null) =>
    request<void>('PUT', `/api/memos/${id}/position`, { afterId, beforeId }),
}
