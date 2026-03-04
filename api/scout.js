export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { prompt } = req.body
  if (!prompt) return res.status(400).json({ error: 'No prompt' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!r.ok) {
      const err = await r.text()
      console.error('[scout] API error:', r.status, err)
      return res.status(r.status).json({ error: 'API ' + r.status, detail: err })
    }

    const data = await r.json()
    console.log('[scout] stop_reason:', data.stop_reason)
    console.log('[scout] content block types:', (data.content || []).map(b => b.type))

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    if (!text) {
      console.error('[scout] No text blocks in response. All blocks:', JSON.stringify(data.content))
      return res.status(500).json({ error: 'No text in response' })
    }

    console.log('[scout] Returning text length:', text.length, 'preview:', text.slice(0, 200))
    return res.status(200).json({ text })
  } catch (e) {
    console.error('[scout] Exception:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
