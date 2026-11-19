// images 버킷의 파일을 모두 내려받아요. 경로는 "{user_id}/{그림 번호}"예요. (Node 내장 fetch만 써요)
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const out = process.argv[2] ?? 'images'
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

async function list(prefix) {
  const items = []
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/images`, {
      method: 'POST', headers, body: JSON.stringify({ prefix, limit: 1000, offset }),
    })
    if (!res.ok) throw new Error(`목록을 읽지 못했어요: ${res.status}`)
    const page = await res.json()
    items.push(...page)
    if (page.length < 1000) return items
  }
}

let count = 0
for (const folder of await list('')) {
  // 폴더(사용자)는 id가 null이에요.
  if (folder.id !== null) continue
  await mkdir(join(out, folder.name), { recursive: true })
  for (const file of await list(`${folder.name}/`)) {
    const res = await fetch(`${url}/storage/v1/object/images/${folder.name}/${file.name}`, { headers })
    if (!res.ok) throw new Error(`내려받지 못했어요: ${folder.name}/${file.name} ${res.status}`)
    await writeFile(join(out, folder.name, file.name), Buffer.from(await res.arrayBuffer()))
    count++
  }
}
console.log(`그림 ${count}개를 내려받았어요.`)
