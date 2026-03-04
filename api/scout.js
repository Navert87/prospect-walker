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
  const MAX_TURNS = 10

  try {
    let turn = 0
    let allText = []

    while (turn < MAX_TURNS) {
      turn++

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
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
      console.log('Raw API response:', JSON.stringify(data.content))

      // Collect any text blocks from this turn
      const turnText = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
      if (turnText.length > 0) allText.push(...turnText)

      // Done — Claude finished its answer
      if (data.stop_reason === 'end_turn' || data.stop_reason === 'max_tokens') {
        break
      }

      // Claude wants to use tools again (e.g. more web searches)
      if (data.stop_reason === 'tool_use') {
        // Add the full assistant response to the conversation
        messages.push({ role: 'assistant', content: data.content })

        // Find all tool_use blocks and send back tool_results so Claude can continue
        const toolUseBlocks = (data.content || []).filter(
          b => b.type === 'tool_use' || b.type === 'server_tool_use'
        )

        if (toolUseBlocks.length === 0) {
          // stop_reason says tool_use but no tool blocks — bail out with what we have
          console.warn('[scout] stop_reason=tool_use but no tool blocks found, breaking')
          break
        }

        const toolResults = toolUseBlocks.map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: 'Search complete. Please continue with your analysis and provide the JSON result.',
        }))

        messages.push({ role: 'user', content: toolResults })
        console.log('[scout] continuing conversation, sent', toolResults.length, 'tool_result(s)')
        continue
      }

      // Unknown stop_reason — break with whatever we have
      console.warn('[scout] unexpected stop_reason:', data.stop_reason)
      break
    }

    const text = allText.join('\n')

    if (!text) {
      console.error('[scout] No text after', turn, 'turn(s)')
      return res.status(500).json({ error: 'No text in response after ' + turn + ' turn(s)' })
    }

    console.log('[scout] Returning text length:', text.length, 'turns:', turn, 'preview:', text.slice(0, 200))
    return res.status(200).json({ text })
  } catch (e) {
    console.error('[scout] Exception:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
