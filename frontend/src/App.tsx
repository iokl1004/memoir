import { useEffect, useState } from 'react'
import { currentUser, type User } from './api'
import AuthScreen from './AuthScreen'
import ConfirmProvider from './ConfirmDialog'
import { store } from './store'
import { supabase } from './supabase'
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
    // 재설정 링크로 왔으면 로그인돼 있어도 새 패스워드 화면부터 보여줘요. (처음 한 번만 확인해요)
    const viaResetLink = resetToken !== undefined
    currentUser().then(u => setUser(viaResetLink ? null : u), () => setUser(null))
    // 다른 탭에서 로그아웃했거나 로그인이 만료되면 로그인 화면으로 가요.
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event !== 'SIGNED_OUT') return
      // 로그인이 끝나면(만료, 다른 기기·탭에서 로그아웃, 패스워드 변경) 이 기기에 남긴 메모도 지워요.
      // 아직 보내지 못한 변경이 있으면 쓴 내용이 사라지지 않게 남겨 두고, 다시 로그인하면 보내요.
      if (store.pending() === 0) void store.destroy()
      setUser(null)
    })
    return () => data.subscription.unsubscribe()
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
