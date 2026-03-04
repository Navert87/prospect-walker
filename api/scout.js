export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { prompt } = req.body
  if (!prompt) return res.status(400).json({ error: 'No prompt' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  // Send SSE keepalives to prevent browser/proxy timeout
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 8000)

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }

  const messages = [{ role: 'user', content: prompt }]
  const MAX_TURNS = 5
  let allText = []

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const isLastTurn = turn === MAX_TURNS - 1
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16000,
          tools: isLastTurn ? undefined : [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: isLastTurn
            ? [...messages, { role: 'user', content: 'Stop searching and return the JSON array now with whatever you have found so far.' }]
            : messages,
        }),
      })

      if (!r.ok) {
        const err = await r.text()
        console.error('[scout] API error:', r.status, err)
        clearInterval(keepalive)
        res.write('data: ' + JSON.stringify({ error: 'API ' + r.status }) + '\n\n')
        return res.end()
      }

      const data = await r.json()
      const blockTypes = (data.content || []).map(b => b.type)
      console.log('[scout] turn', turn, 'stop_reason:', data.stop_reason, 'blocks:', blockTypes.join(', '))

      for (const b of data.content || []) {
        if (b.type === 'text' && b.text) allText.push(b.text)
      }

      if (data.stop_reason === 'end_turn' || data.stop_reason === 'max_tokens') {
        break
      }

      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: data.content })

        const toolResults = (data.content || [])
          .filter(b => b.type === 'tool_use' || b.type === 'server_tool_use')
          .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }))

        if (toolResults.length === 0) {
          console.warn('[scout] stop_reason=tool_use but no tool blocks, breaking')
          break
        }

        messages.push({ role: 'user', content: toolResults })
        console.log('[scout] continuing, sent', toolResults.length, 'tool_result(s)')
        continue
      }

      console.warn('[scout] unexpected stop_reason:', data.stop_reason)
      break
    }

    clearInterval(keepalive)
    const text = allText.join('\n')

    if (!text) {
      console.error('[scout] No text after all turns')
      res.write('data: ' + JSON.stringify({ error: 'No text in response' }) + '\n\n')
      return res.end()
    }

    console.log('[scout] Success, text length:', text.length, 'preview:', text.slice(0, 200))
    res.write('data: ' + JSON.stringify({ text }) + '\n\n')
    res.end()
  } catch (e) {
    clearInterval(keepalive)
    console.error('[scout] Exception:', e.message)
    res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n')
    res.end()
  }
}
