import { useEffect, useState } from 'react'
import { api, type User } from './api'
import AuthScreen from './AuthScreen'
import ConfirmProvider from './ConfirmDialog'
import Workspace from './Workspace'

/** 메일의 재설정 링크(?reset=토큰)로 들어왔으면 토큰을 꺼내고, 주소창에서는 바로 지워요(기록·공유에 남지 않게). */
function takeResetToken(): string | undefined {
  const url = new URL(window.location.href)
  const token = url.searchParams.get('reset') ?? undefined
  if (token) {
    url.searchParams.delete('reset')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }
  return token
}

export default function App() {
  const [resetToken, setResetToken] = useState(takeResetToken)
  // undefined: 아직 확인 중, null: 로그인 안 됨
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    // 첫 요청에서 XSRF-TOKEN 쿠키도 함께 받아요.
    // 재설정 링크로 왔으면 로그인돼 있어도 새 패스워드 화면부터 보여줘요. (처음 한 번만 확인해요)
    const viaResetLink = resetToken !== undefined
    api.me().then(u => setUser(viaResetLink ? null : u), () => setUser(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ConfirmProvider>
      {user === undefined
        ? <p className="boot" role="status">불러오는 중</p>
        : user === null
          ? <AuthScreen resetToken={resetToken}
                        onLogin={u => { setResetToken(undefined); setUser(u) }} />
          : <Workspace user={user} onLogout={() => setUser(null)} />}
    </ConfirmProvider>
  )
}
