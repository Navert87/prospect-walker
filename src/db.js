import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// Single-row JSON storage for simplicity
// Table: prospect_data (id text primary key, data jsonb, updated_at timestamptz)
const ROW_ID = 'main'

export async function loadData() {
  const { data, error } = await supabase
    .from('prospect_data')
    .select('data')
    .eq('id', ROW_ID)
    .single()
  if (error && error.code !== 'PGRST116') console.error('Load error:', error)
  return data?.data || null
}

export async function saveData(payload) {
  const { error } = await supabase
    .from('prospect_data')
    .upsert({
      id: ROW_ID,
      data: payload,
      updated_at: new Date().toISOString(),
    })
  if (error) {
    console.error('Save error:', error)
    return false
  }
  return true
}
