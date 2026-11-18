export type User = { id: number; email: string }
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
  /** 편집기 본문(글자와 그림). 그림 기능 전에 쓴 메모는 null이라 content를 문단으로 바꿔 보여줘요. */
  contentHtml: string | null
  createdAt: string
  updatedAt: string
}
export type MemoSummary = Omit<Memo, 'content' | 'contentHtml'> & { preview: string }
/** totalCapped이면 total은 "이 수 이상"이에요. */
export type MemoPage = { items: MemoSummary[]; page: number; total: number; totalCapped: boolean; hasNext: boolean }
export type MemoSort = 'CREATED_DESC' | 'CREATED_ASC' | 'UPDATED_DESC' | 'UPDATED_ASC' | 'TITLE_ASC' | 'TITLE_DESC' | 'CUSTOM'
export type MemoFilter = { sectionId?: number; q?: string; from?: string; to?: string }

/** 서버가 보낸 ProblemDetail의 status와 detail을 그대로 들고 있어요. */
export class ApiError extends Error {
  status: number
  /** ProblemDetail 본문 전체. 서버가 덧붙인 값(captchaRequired 등)을 읽을 때 써요. */
  data?: Record<string, unknown>
  constructor(status: number, message: string, data?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.data = data
  }
}

function xsrfToken(): string {
  return document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)?.[1] ?? ''
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      // FormData는 브라우저가 경계값을 붙인 Content-Type을 직접 정해요.
      ...(body !== undefined && !form && { 'Content-Type': 'application/json' }),
      // 세션 쿠키 방식이라 CSRF 토큰을 헤더로 같이 보내야 POST, PATCH, PUT, DELETE가 통과해요.
      'X-XSRF-TOKEN': decodeURIComponent(xsrfToken()),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, data?.detail && data.detail !== 'Invalid request content.'
      ? data.detail
      : messageFor(res.status), data ?? undefined)
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
  signup: (email: string, password: string, captchaToken?: string) =>
    request<User>('POST', '/api/auth/signup', { email, password, captchaToken }),
  /** captchaToken: 여러 번 틀린 뒤 서버가 캡차를 요구할 때만 보내요. */
  login: (email: string, password: string, captchaToken?: string) =>
    request<User>('POST', '/api/auth/login', { email, password, captchaToken }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  /** 패스워드 찾기 메일. 가입하지 않은 이메일이어도 똑같이 성공해요(가입 여부를 숨겨요). */
  requestPasswordReset: (email: string) => request<void>('POST', '/api/auth/password-reset', { email }),
  confirmPasswordReset: (token: string, password: string) =>
    request<void>('POST', '/api/auth/password-reset/confirm', { token, password }),
  /** 로그인한 상태에서 패스워드 변경. 다른 기기의 로그인은 끊겨요. */
  changePassword: (currentPassword: string, newPassword: string, captchaToken?: string) =>
    request<void>('PUT', '/api/auth/password', { currentPassword, newPassword, captchaToken }),
  /** 계정과 모든 메모를 지우고 로그아웃해요. */
  deleteAccount: (password: string, captchaToken?: string) =>
    request<void>('DELETE', '/api/auth/account', { password, captchaToken }),

  sections: () => request<Section[]>('GET', '/api/sections'),
  createSection: (name: string, parentId: number | null) => request<Section>('POST', '/api/sections', { name, parentId }),
  renameSection: (id: number, name: string) => request<Section>('PATCH', `/api/sections/${id}`, { name }),
  deleteSection: (id: number) => request<void>('DELETE', `/api/sections/${id}`),
  /** parentId가 null이면 최상위, beforeId가 null이면 그 안의 맨 아래로 옮겨요. 하위 섹션과 메모는 함께 따라가요. */
  moveSection: (id: number, parentId: number | null, beforeId: number | null = null) =>
    request<Section>('PUT', `/api/sections/${id}/parent`, { parentId, beforeId }),

  memos: (filter: MemoFilter, sort: MemoSort, page: number, size?: number) =>
    request<MemoPage>('GET', `/api/memos?${query({ ...filter, sort, page, size })}`),
  memo: (id: number) => request<Memo>('GET', `/api/memos/${id}`),
  createMemo: (m: { sectionId: number; title: string; contentHtml: string }) => request<Memo>('POST', '/api/memos', m),
  updateMemo: (id: number, m: { sectionId: number; title: string; contentHtml: string }) =>
    request<Memo>('PATCH', `/api/memos/${id}`, m),
  deleteMemo: (id: number) => request<void>('DELETE', `/api/memos/${id}`),
  /** 본문에 붙여넣은 그림을 올려요. 돌려받은 url을 <img src>에 넣어요. */
  uploadImage: (file: Blob) => {
    const form = new FormData()
    form.append('file', file, 'image')
    return request<{ id: number; url: string }>('POST', '/api/images', form)
  },
  /** 여러 메모를 한 섹션으로 옮겨요. 수정일도 바뀌어요. 하나라도 남의 메모면 아무것도 바뀌지 않아요. */
  moveMemos: (ids: number[], sectionId: number) => request<void>('POST', '/api/memos/bulk-move', { ids, sectionId }),
  /** 여러 메모를 한 번에 지워요. */
  deleteMemos: (ids: number[]) => request<void>('POST', '/api/memos/bulk-delete', { ids }),
  /** 끌어 놓은 자리의 위(afterId)와 아래(beforeId) 메모 */
  moveMemo: (id: number, afterId: number | null, beforeId: number | null) =>
    request<void>('PUT', `/api/memos/${id}/position`, { afterId, beforeId }),
}
