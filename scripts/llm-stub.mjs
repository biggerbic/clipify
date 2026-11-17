// Test-only stand-in for OpenShorts' moment picker (an OpenAI-compatible /chat/completions server).
// It answers OpenShorts' two schemas (ScoreResponse, DetailResponse) by picking the whole clip,
// so the rest of the pipeline (download, transcribe, reframe, captions, hooks) can be tested without a Gemini key.
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 11434)

function answer(prompt, schemaName) {
  const windows = [...prompt.matchAll(/"id":\s*"([^"]+)",\s*"start":\s*([\d.]+),\s*"end":\s*([\d.]+)/g)].map((m) => ({
    id: m[1],
    start: Number(m[2]),
    end: Number(m[3])
  }))
  const duration = Number(/VIDEO_DURATION_SECONDS:\s*([\d.]+)/.exec(prompt)?.[1] ?? 0)
  if (/Score/i.test(schemaName)) {
    return { windows: windows.map((w) => ({ ...w, score: 9, reason: 'stub' })) }
  }
  const start = windows.length ? Math.min(...windows.map((w) => w.start)) : 0
  const end = duration || (windows.length ? Math.max(...windows.map((w) => w.end)) : 30)
  return {
    shorts: [
      {
        start,
        end,
        source_window_id: windows[0]?.id ?? 'w0',
        predicted_score: 9,
        video_description_for_tiktok: 'Stub TikTok description #test',
        video_description_for_instagram: 'Stub Instagram description #test',
        video_title_for_youtube_short: 'Stub title for this clip',
        viral_hook_text: 'WAIT FOR IT',
        why: 'stub'
      }
    ]
  }
}

createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const json = body ? JSON.parse(body) : {}
    const prompt = (json.messages ?? []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
    const schemaName = json.response_format?.json_schema?.name ?? ''
    const content = JSON.stringify(answer(prompt, schemaName))
    console.log(`[stub] ${schemaName || 'no-schema'} -> ${content.slice(0, 160)}`)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: 'stub', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }))
  })
}).listen(port, '127.0.0.1', () => console.log(`llm stub on ${port}`))
