import { useState } from 'react'

type Theme = 'light' | 'dark'

/** index.html의 첫 스크립트가 저장된 테마를 미리 적용해 두고, 여기서는 바꾸기만 해요. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) ?? 'dark')
  const next: Theme = theme === 'dark' ? 'light' : 'dark'

  function toggle() {
    document.documentElement.dataset.theme = next
    localStorage.setItem('memoir-theme', next)
    setTheme(next)
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle}
            aria-label={next === 'light' ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기'}
            title={next === 'light' ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기'}>
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
      )}
    </button>
  )
}
