import { useEffect, useState } from 'react'
import { api, type User } from './api'
import AuthScreen from './AuthScreen'
import ConfirmProvider from './ConfirmDialog'
import Workspace from './Workspace'

export default function App() {
  // undefined: 아직 확인 중, null: 로그인 안 됨
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    // 첫 요청에서 XSRF-TOKEN 쿠키도 함께 받아요.
    api.me().then(setUser, () => setUser(null))
  }, [])

  return (
    <ConfirmProvider>
      {user === undefined
        ? <p className="boot" role="status">불러오는 중</p>
        : user === null
          ? <AuthScreen onLogin={setUser} />
          : <Workspace user={user} onLogout={() => setUser(null)} />}
    </ConfirmProvider>
  )
}
