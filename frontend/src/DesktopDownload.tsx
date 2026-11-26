/** PC 앱 설치 파일. desktop.yml이 릴리스마다 같은 이름으로 올려서 주소가 바뀌지 않아요. */
const DOWNLOAD_URL = 'https://github.com/iokl1004/memoir/releases/latest/download/memoir-setup.exe'
const DESKTOP_KEY = 'memoir-desktop'

// PC 앱 창은 ?app=desktop으로 열려요(desktop/src-tauri/tauri.conf.json). 앱의 저장소는 브라우저와 따로라서,
// 표시를 남겨 두면 새로 고침 뒤에도 앱 안인 줄 알아요. 주소창에서는 지워요.
const url = new URL(window.location.href)
if (url.searchParams.get('app') === 'desktop') {
  localStorage.setItem(DESKTOP_KEY, '1')
  url.searchParams.delete('app')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

/** Windows 브라우저에서만 보여요. 휴대폰, Mac, PC 앱 안에서는 숨겨요. */
const showDesktopDownload = localStorage.getItem(DESKTOP_KEY) !== '1' && navigator.userAgent.includes('Windows')

/** title이 있으면 계정 창의 한 칸(제목 + 링크)으로 보여요. */
export default function DesktopDownload({ title }: { title?: string }) {
  if (!showDesktopDownload) return null
  const link = (
    <div className="desktop-dl">
      <a className="textbtn" href={DOWNLOAD_URL}>Windows용 PC 앱 받기</a>
      <p className="field__hint">처음 실행할 때 "Windows의 PC 보호" 창이 뜨면 추가 정보 → 실행을 눌러 주세요.</p>
    </div>
  )
  return title ? <div className="account__section"><h3 className="account__label">{title}</h3>{link}</div> : link
}
