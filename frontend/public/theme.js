// 저장된 테마(없으면 OS 설정)를 첫 화면 전에 적용해서 깜빡임을 막아요.
// 보안 정책(CSP)이 HTML 안의 스크립트를 막아서 파일로 따로 둬요.
try {
  document.documentElement.dataset.theme = localStorage.getItem('memoir-theme')
    || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
} catch { document.documentElement.dataset.theme = 'dark' }
