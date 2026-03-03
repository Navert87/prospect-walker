export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const { prompt } = req.body
  if (!prompt) return res.status(400).json({ error: 'No prompt' })

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  const body = {
    model: 'openai/gpt-4.1-mini',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  }

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://prospect-walker.vercel.app',
        'X-Title': 'Prospect Walker',
      },
      body: JSON.stringify(body),
    })

    if (!r.ok) {
      const err = await r.text()
      return res.status(r.status).json({ error: 'API ' + r.status, detail: err })
    }

    const data = await r.json()
    const text = data.choices?.[0]?.message?.content || ''

    return res.status(200).json({ text })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
