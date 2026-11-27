import { store } from './store'

/**
 * 본문에 저장하는 그림 주소는 "/img/{번호}"예요. 아직 올리지 못한 그림은 임시 번호(음수)예요.
 * 파일은 비공개 Storage에 있어서, 편집기에 보여 줄 때만 이 기기에 받아 둔 파일 주소(blob:)로 바꾸고
 * (data-img에 번호를 남겨요), 저장할 때 다시 "/img/{번호}"로 돌려요.
 */
const STORED = /src="\/img\/(-?\d+)"/g

/** 저장된 본문 → 편집기에 넣을 본문 */
export async function toEditorHtml(html: string): Promise<string> {
  const ids = [...new Set([...html.matchAll(STORED)].map(m => m[1]))]
  if (!ids.length) return html
  const urls = new Map(await Promise.all(ids.map(async id => [id, await store.imageSrc(Number(id))] as const)))
  // 받지 못한 그림(지워진 그림, 오프라인에서 처음 보는 그림)은 빈 그림으로 두되 번호는 남겨요.
  return html.replace(STORED, (_, id: string) => `src="${urls.get(id) ?? ''}" data-img="${id}"`)
}

/** 편집기 본문 → 저장할 본문 */
export function toStoredHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const img of doc.querySelectorAll<HTMLImageElement>('img[data-img]')) {
    img.setAttribute('src', `/img/${img.dataset.img}`)
    img.removeAttribute('data-img')
  }
  return doc.body.innerHTML
}

/** 새로 넣은 그림을 편집기에 넣을 때 쓸 주소 */
export const editorSrc = (id: number) => store.imageSrc(id)

const MAX_SIDE = 2000
/** 한 사람의 그림 저장 공간. 서버의 IMAGE_QUOTA_MB(upload-image 함수)와 같아야 해요. */
export const IMAGE_QUOTA_MB = 50

async function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, 0.85))
}

/**
 * 올리기 전에 그림을 줄여요. 긴 변을 2000px 이하로 줄이고, PNG와 JPEG 중 작은 쪽을 골라요.
 * 휴대폰 사진의 회전 정보는 브라우저가 읽어서 똑바로 그려요. GIF(움직이는 그림)와 WebP는 그대로 둬요.
 * 줄일 필요가 없는데 다시 저장한 게 더 크면 원래 파일을 써요.
 */
export async function shrinkImage(file: Blob): Promise<Blob> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const candidates = [await encode(canvas, 'image/png')]
  // 투명한 부분이 있는 PNG는 JPEG로 바꾸면 검게 변해서 PNG로만 저장해요.
  if (file.type === 'image/jpeg' || !hasAlpha(canvas)) candidates.push(await encode(canvas, 'image/jpeg'))
  const best = candidates.filter((b): b is Blob => b !== null).sort((a, b) => a.size - b.size)[0]
  if (!best) return file
  return scale === 1 && file.size <= best.size ? file : best
}

function hasAlpha(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}
