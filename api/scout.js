export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { prompt } = req.body
  if (!prompt) return res.status(400).json({ error: 'No prompt' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }

  const messages = [{ role: 'user', content: prompt }]
  const MAX_TURNS = 15
  let allText = []

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages,
        }),
      })

      if (!r.ok) {
        const err = await r.text()
        console.error('[scout] API error:', r.status, err)
        return res.status(r.status).json({ error: 'API ' + r.status, detail: err })
      }

      const data = await r.json()
      const blockTypes = (data.content || []).map(b => b.type)
      console.log('[scout] turn', turn, 'stop_reason:', data.stop_reason, 'blocks:', blockTypes.join(', '))

      // Collect text blocks from this turn
      for (const b of data.content || []) {
        if (b.type === 'text' && b.text) allText.push(b.text)
      }

      // Done
      if (data.stop_reason === 'end_turn' || data.stop_reason === 'max_tokens') {
        break
      }

      // Model wants to continue (more web searches) — feed results back
      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: data.content })

        // Build tool_result blocks for every tool_use / server_tool_use block
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

    const text = allText.join('\n')

    if (!text) {
      console.error('[scout] No text after all turns')
      return res.status(500).json({ error: 'No text in response' })
    }

    console.log('[scout] Success, text length:', text.length, 'preview:', text.slice(0, 200))
    return res.status(200).json({ text })
  } catch (e) {
    console.error('[scout] Exception:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
