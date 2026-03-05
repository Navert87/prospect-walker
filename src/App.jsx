import { useState, useEffect, useCallback, useRef } from "react"
import { loadData, saveData } from "./db"

const STATUS = {
  not_visited: { label: "Not Visited", color: "#7B8BA5", bg: "#1A2236", icon: "○", sort: 0 },
  visited: { label: "Visited", color: "#5DE4A5", bg: "#0D3B2A", icon: "✓", sort: 2 },
  interested: { label: "Interested", color: "#60B8F7", bg: "#0D2847", icon: "★", sort: 1 },
  go_back: { label: "Go Back", color: "#F5C542", bg: "#3D2E0A", icon: "↻", sort: 1 },
  not_interested: { label: "Not Interested", color: "#E8606A", bg: "#3B1418", icon: "✕", sort: 3 },
}

const STATUS_ORDER = ["not_visited", "visited", "interested", "go_back", "not_interested"]

function nextStatus(current) {
  var i = STATUS_ORDER.indexOf(current)
  if (i === -1) return STATUS_ORDER[0]
  return STATUS_ORDER[(i + 1) % STATUS_ORDER.length]
}

const WS = {
  unknown: { label: "?", color: "#7B8BA5", bg: "#1A2236" },
  poor: { label: "Poor", color: "#E8606A", bg: "#3B1418" },
  weak: { label: "Weak", color: "#F5C542", bg: "#3D2E0A" },
  decent: { label: "Decent", color: "#60B8F7", bg: "#0D2847" },
  strong: { label: "Strong", color: "#5DE4A5", bg: "#0D3B2A" },
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6)
function cleanUrl(u) { if (!u || typeof u !== "string" || !u.trim()) return null; u = u.trim(); if (u === "null" || u === "N/A" || u === "none") return null; if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u; return u }
const CL_DARK = { bg: "#0B1121", card: "#131B2E", border: "#1E2D4A", bL: "#2A3F65", text: "#D4DCE8", mut: "#6B7FA3", dim: "#3E5278", wh: "#F0F4F8", acc: "#4F8EF7", accBg: "#162044", warn: "#F5C542", warnBg: "#3D2E0A" }
const CL_LIGHT = { bg: "#F5F7FA", card: "#FFFFFF", border: "#E2E8F0", bL: "#CBD5E1", text: "#1E293B", mut: "#64748B", dim: "#94A3B8", wh: "#0F172A", acc: "#4F8EF7", accBg: "#EFF6FF", warn: "#D97706", warnBg: "#FEF3C7" }
const FT = "'Geist Mono','SF Mono','JetBrains Mono',ui-monospace,monospace"
const APP_PW = import.meta.env.VITE_APP_PASSWORD || ""
const LS_KEY = "pw_authed"
const PHONE_RE = /(\+?1?\s*[-.(]?\d{3}[-.)]\s*\d{3}[-.]?\d{4})/

function grabJSON(t) {
  try { return JSON.parse(t) } catch {}
  try { return JSON.parse(t.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()) } catch {}
  var m = t.match(/\[[\s\S]*\]/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  var o = t.match(/\{[\s\S]*\}/)
  if (o) { try { var r = JSON.parse(o[0]); return Array.isArray(r) ? r : [r] } catch {} }
  return null
}

async function callScout(prompt) {
  var r = await fetch("/api/scout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })
  if (!r.ok) throw new Error("API " + r.status)
  var body = await r.text()
  var lines = body.split("\n").filter(function(l) { return l.startsWith("data: ") })
  if (lines.length === 0) throw new Error("Empty response")
  var d = JSON.parse(lines[lines.length - 1].slice(6))
  if (d.error) throw new Error(d.error)
  return d.text
}

async function getNHs(city) {
  var raw = await callScout("List main neighborhoods in " + city + " with concentrations of small independent local businesses. NOT chains. ONLY return a JSON array, no other text or markdown. Each object: {\"name\":\"Name\",\"description\":\"one sentence\"}. 15-25 neighborhoods sorted by small business density.")
  var p = grabJSON(raw)
  if (!p || !Array.isArray(p)) throw new Error("Parse failed")
  return p
}

async function findBiz(nh, city, coords) {
  var geo = coords
    ? "STRICT RADIUS: Only list businesses within a half mile of coordinates " + coords.lat + ", " + coords.lng + ". Every business must be walkable in under 10 minutes. Do NOT include anything farther away.\n\n"
    : "STRICT GEOGRAPHIC CONSTRAINT: ONLY list businesses physically located within " + nh + " of " + city + ". Do NOT include businesses from adjacent neighborhoods.\n\n"
  var raw = await callScout(geo + "List 10-15 small independent businesses (not chains) in " + nh + ", " + city + ".\n\nRules:\n- Search the web to verify each business currently exists\n- Every business MUST have a real street address\n- NO chains or franchises\n- 5 verified is better than 15 guessed\n\nReturn ONLY a JSON array:\n[{\"name\":\"Exact Business Name\",\"address\":\"Full street address\",\"type\":\"category\"}]")
  var found = grabJSON(raw)
  if (!found || !Array.isArray(found) || found.length === 0) throw new Error("No businesses found - try again")
  return found
}

async function identifyLocation(lat, lng) {
  var raw = await callScout("What is the most specific, commonly-used neighborhood name for GPS coordinates [" + lat + ", " + lng + "]? Use the local name residents and businesses would use (e.g. 'Capitol Hill' not 'Central Seattle', 'Fremont' not 'North Seattle'). Return ONLY a JSON object, no other text: {\"neighborhood\":\"Specific Neighborhood Name\",\"city\":\"City Name\"}")
  var p = grabJSON(raw)
  if (!p || !p.neighborhood || !p.city) throw new Error("Could not identify location")
  if (Array.isArray(p)) return p[0]
  return p
}

function makeWalkUrl(list, originCoords) {
  var a = list.filter(function(p) { return p.address }).map(function(p) { return encodeURIComponent(p.address) })
  if (a.length === 0) return null
  if (!originCoords && a.length < 2) return a.length === 1 ? "https://www.google.com/maps/search/" + a[0] : null
  var origin = originCoords ? encodeURIComponent(originCoords.lat + "," + originCoords.lng) : a[0]
  var dest = a[a.length - 1]
  var waypoints = originCoords ? a.slice(0, -1) : a.slice(1, -1)
  var u = "https://www.google.com/maps/dir/?api=1&origin=" + origin + "&destination=" + dest + "&travelmode=walking"
  if (waypoints.length > 0) u += "&waypoints=" + waypoints.join("|")
  return u
}

function csvEsc(v) {
  if (v == null) return ""
  var s = String(v)
  if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function toCSV(prospects, includeLocation, filename) {
  var cols = ["Name", "Address", "Type", "Web Score", "Status", "Emailed", "Contact", "Notes", "Website", "Visited At"]
  if (includeLocation) cols.push("Neighborhood", "City")
  var rows = [cols.join(",")]
  prospects.forEach(function(p) {
    var row = [
      csvEsc(p.name), csvEsc(p.address), csvEsc(p.type), csvEsc(p.webScore),
      csvEsc((STATUS[p.status] || {}).label || p.status), csvEsc(p.emailed ? "Yes" : "No"),
      csvEsc(p.contact), csvEsc(p.notes),
      csvEsc(p.currentWebsite), csvEsc(p.visitedAt ? new Date(p.visitedAt).toLocaleDateString() : ""),
    ]
    if (includeLocation) { row.push(csvEsc(p._neighborhood)); row.push(csvEsc(p._city)) }
    rows.push(row.join(","))
  })
  var blob = new Blob([rows.join("\n")], { type: "text/csv" })
  var url = URL.createObjectURL(blob)
  var a = document.createElement("a")
  a.href = url
  a.download = filename || (prospects[0] && prospects[0]._city ? prospects[0]._city : "prospects") + ".csv"
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  var [authed, setAuthed] = useState(function() {
    if (!APP_PW) return true
    return localStorage.getItem(LS_KEY) === APP_PW
  })
  var [pw, setPw] = useState("")
  var [pwErr, setPwErr] = useState(false)
  var [data, setData] = useState({ cities: {} })
  var [loading, setLoading] = useState(true)

  // Feature 1: restore view from localStorage
  var saved = null
  try { saved = JSON.parse(localStorage.getItem("pw_view_state")) } catch {}
  var [view, setView] = useState(saved && (saved.view === "home" || saved.view === "list") ? saved.view : "home")
  var [cId, setCId] = useState(saved ? saved.cId : null)
  var [nId, setNId] = useState(saved ? saved.nId : null)

  var [input, setInput] = useState("")
  var [nhPick, setNhPick] = useState([])
  var [sel, setSel] = useState(new Set())
  var [busy, setBusy] = useState("")
  var [exp, setExp] = useState(null)
  var [form, setForm] = useState({})
  var [eId, setEId] = useState(null)
  var [filt, setFilt] = useState("all")
  var [ok, setOk] = useState("")
  var [pCity, setPCity] = useState("")
  var [err, setErr] = useState("")
  var [openCity, setOpenCity] = useState(null)
  // walkSel replaced by walkOrder + walkSelSet (Feature 13)
  var [lastScoutCount, setLastScoutCount] = useState(null)
  var [addNhCity, setAddNhCity] = useState(null)
  var [addNhInput, setAddNhInput] = useState("")
  var [userCoords, setUserCoords] = useState(null)
  var [nearbyPrompt, setNearbyPrompt] = useState(false)
  var [nearbyInput, setNearbyInput] = useState("")

  // Feature 9: quick add state
  var [quickAdd, setQuickAdd] = useState(false)
  var [quickName, setQuickName] = useState("")

  // Feature 18: light/dark theme
  var [theme, setTheme] = useState(function() { return localStorage.getItem("pw_theme") || "dark" })

  // Feature 14: global search
  var [searchOpen, setSearchOpen] = useState(false)
  var [searchQuery, setSearchQuery] = useState("")
  var [searchHighlight, setSearchHighlight] = useState(null)

  // Feature 12: start from here
  var [startFromHere, setStartFromHere] = useState(true)

  // Feature 13: walk order (replaces walkSel Set)
  var [walkOrder, setWalkOrder] = useState([])
  var [dragIdx, setDragIdx] = useState(null)
  var [dragOverIdx, setDragOverIdx] = useState(null)

  // Feature 17: pull to refresh
  var [pullDist, setPullDist] = useState(0)
  var [refreshing, setRefreshing] = useState(false)

  // Feature 4: long-press status flash
  var [statusFlash, setStatusFlash] = useState(null)
  var longPressTimer = useRef(null)
  var longPressTriggered = useRef(false)

  // Feature 11: swipe gesture refs
  var swipeStartX = useRef(null)
  var swipeStartY = useRef(null)
  var swipeTriggered = useRef(false)

  // Feature 17: pull-to-refresh ref
  var pullStartY = useRef(null)

  // Feature 13: drag reorder ref
  var walkListRef = useRef(null)

  // Feature 1: save view state to localStorage
  useEffect(function() {
    localStorage.setItem("pw_view_state", JSON.stringify({ view: view, cId: cId, nId: nId }))
  }, [view, cId, nId])

  // Load data + validate saved view state
  useEffect(function() {
    loadData().then(function(d) {
      if (d) {
        setData(d)
        var s = null
        try { s = JSON.parse(localStorage.getItem("pw_view_state")) } catch {}
        if (s && s.view === "list") {
          if (!s.cId || !d.cities[s.cId] || !s.nId || !(d.cities[s.cId].neighborhoods || {})[s.nId]) {
            setView("home"); setCId(null); setNId(null)
          }
        }
      }
      setLoading(false)
    }).catch(function() { setLoading(false) })
  }, [])

  useEffect(function() {
    if (!authed || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      function(pos) { setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }) },
      function() {},
      { enableHighAccuracy: true, timeout: 5000 }
    )
  }, [authed])

  // Feature 18: persist theme
  useEffect(function() { localStorage.setItem("pw_theme", theme) }, [theme])

  var CL = theme === "light" ? CL_LIGHT : CL_DARK

  // Feature 13: derive Set from walkOrder
  var walkSelSet = new Set(walkOrder)

  var persist = useCallback(async function(nd) {
    setData(nd)
    var success = await saveData(nd)
    setOk(success ? "✓" : "!")
    setTimeout(function() { setOk("") }, 1200)
  }, [])

  var city = cId ? data.cities[cId] : null
  var nh = city && nId ? (city.neighborhoods || {})[nId] : null

  function st(n) {
    var p = Object.values(n.prospects || {})
    return {
      total: p.length,
      visited: p.filter(function(x) { return x.status === "visited" }).length,
      interested: p.filter(function(x) { return x.status === "interested" }).length,
      goBack: p.filter(function(x) { return x.status === "go_back" }).length,
      notVis: p.filter(function(x) { return x.status === "not_visited" }).length,
    }
  }

  function deepSet(updates) {
    var nd = JSON.parse(JSON.stringify(data))
    updates(nd)
    persist(nd)
  }

  var doAddCity = async function() {
    var name = input.trim()
    if (!name) return
    setPCity(name); setBusy("Finding neighborhoods..."); setErr("")
    try {
      var nhs = await getNHs(name)
      setNhPick(nhs); setSel(new Set()); setView("pick")
    } catch(e) { setErr("Error: " + e.message) }
    setBusy("")
  }

  var doConfirmNHs = function() {
    var id = uid()
    var nbs = {}
    nhPick.forEach(function(n, i) {
      if (!sel.has(i)) return
      var nid = uid()
      nbs[nid] = { id: nid, name: n.name, description: n.description || "", prospects: {} }
    })
    deepSet(function(d) { d.cities[id] = { id: id, name: pCity, neighborhoods: nbs } })
    setInput(""); setPCity(""); setView("home")
  }

  var doScout = async function() {
    if (!nh || !city) return
    setBusy("Locating " + nh.name + "..."); setErr("")
    try {
      var geoRaw = await callScout("What are the approximate center coordinates (latitude, longitude) of " + nh.name + ", " + city.name + "? Return ONLY JSON: {\"lat\":number,\"lng\":number}")
      var coords = grabJSON(geoRaw)
      if (!coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") throw new Error("Could not locate " + nh.name)
      if (Array.isArray(coords)) coords = coords[0]
      setBusy("Finding businesses in " + nh.name + "...")
      var biz = await findBiz(nh.name, city.name, coords)
      var totalFound = biz.length
      var addedCount = 0
      deepSet(function(d) {
        var n = d.cities[cId].neighborhoods[nId]
        var pros = n.prospects
        var existing = Object.values(pros).map(function(p) { return p.name.toLowerCase().trim() })
        var blocklist = (n.blocklist || [])
        biz.forEach(function(b) {
          var bName = (b.name || "").toLowerCase().trim()
          if (!bName || existing.indexOf(bName) !== -1 || blocklist.indexOf(bName) !== -1) return
          existing.push(bName)
          addedCount++
          var pid = uid()
          pros[pid] = {
            id: pid, name: b.name || "Unknown", address: b.address || "", type: b.type || "",
            webScore: "unknown", currentWebsite: null, status: "not_visited",
            notes: "", contact: "", emailed: false, visitedAt: null,
          }
        })
      })
      setWalkOrder([])
      var skippedCount = totalFound - addedCount
      setLastScoutCount({ total: totalFound, skipped: skippedCount, added: addedCount })
      setTimeout(function() { setLastScoutCount(null) }, 3000)
    } catch(e) { setErr("Scout failed: " + e.message) }
    setBusy("")
  }

  var doUpdateP = function(pid, upd) {
    deepSet(function(d) {
      var p = d.cities[cId].neighborhoods[nId].prospects[pid]
      Object.assign(p, upd)
      if ((upd.status === "visited" || upd.status === "interested") && !p.visitedAt) p.visitedAt = new Date().toISOString()
    })
  }

  var doAddP = function(f) {
    deepSet(function(d) {
      var pid = uid()
      d.cities[cId].neighborhoods[nId].prospects[pid] = Object.assign({ id: pid, contact: "", visitedAt: null, emailed: false }, f)
    })
    setView("list")
  }

  var doDelP = function(pid) {
    deepSet(function(d) { delete d.cities[cId].neighborhoods[nId].prospects[pid] })
    setView("list")
  }

  var doDelNh = function() {
    deepSet(function(d) { delete d.cities[cId].neighborhoods[nId] })
    setNId(null); setView("home")
  }

  var doLogin = function() {
    if (pw === APP_PW) {
      localStorage.setItem(LS_KEY, pw)
      setAuthed(true)
      setPw("")
      setPwErr(false)
    } else {
      setPwErr(true)
    }
  }

  var doLogout = function() {
    localStorage.removeItem(LS_KEY)
    setAuthed(false)
    setPw("")
  }

  var doNearbyWithCoords = async function(lat, lng) {
    try {
      setBusy("Identifying neighborhood...")
      var loc = await identifyLocation(lat, lng)
      setBusy("Finding businesses in " + loc.neighborhood + "...")
      var biz = await findBiz(loc.neighborhood, loc.city, { lat: lat, lng: lng })
      var totalFound = biz.length
      var targetCityId = null, targetNhId = null
      Object.keys(data.cities).forEach(function(id) {
        if (data.cities[id].name.toLowerCase() === loc.city.toLowerCase()) targetCityId = id
      })
      if (targetCityId && data.cities[targetCityId]) {
        var nhs = data.cities[targetCityId].neighborhoods || {}
        Object.keys(nhs).forEach(function(id) {
          if (nhs[id].name.toLowerCase() === loc.neighborhood.toLowerCase()) targetNhId = id
        })
      }
      if (!targetCityId) targetCityId = uid()
      if (!targetNhId) targetNhId = uid()
      var addedCount = 0
      deepSet(function(d) {
        if (!d.cities[targetCityId]) d.cities[targetCityId] = { id: targetCityId, name: loc.city, neighborhoods: {} }
        if (!d.cities[targetCityId].neighborhoods[targetNhId]) d.cities[targetCityId].neighborhoods[targetNhId] = { id: targetNhId, name: loc.neighborhood, description: "", prospects: {} }
        var n = d.cities[targetCityId].neighborhoods[targetNhId]
        var pros = n.prospects
        var existing = Object.values(pros).map(function(p) { return p.name.toLowerCase().trim() })
        var blocklist = (n.blocklist || [])
        biz.forEach(function(b) {
          var bName = (b.name || "").toLowerCase().trim()
          if (!bName || existing.indexOf(bName) !== -1 || blocklist.indexOf(bName) !== -1) return
          existing.push(bName)
          addedCount++
          var pid = uid()
          pros[pid] = {
            id: pid, name: b.name || "Unknown", address: b.address || "", type: b.type || "",
            webScore: "unknown", currentWebsite: null, status: "not_visited",
            notes: "", contact: "", emailed: false, visitedAt: null,
          }
        })
      })
      setCId(targetCityId)
      setNId(targetNhId)
      var skippedCount = totalFound - addedCount
      setLastScoutCount({ total: totalFound, skipped: skippedCount, added: addedCount })
      setTimeout(function() { setLastScoutCount(null) }, 3000)
      setFilt("all")
      setExp(null)
      setWalkOrder([])
      setView("list")
    } catch(e) { setErr("Nearby scout failed: " + e.message) }
    setBusy("")
  }

  var doNearby = function() {
    setErr("")
    setBusy("Getting location...")
    if (!navigator.geolocation) {
      setBusy("")
      setNearbyPrompt(true)
      return
    }
    navigator.geolocation.getCurrentPosition(
      function(pos) { doNearbyWithCoords(pos.coords.latitude, pos.coords.longitude) },
      function() {
        setBusy("")
        setNearbyPrompt(true)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  var doNearbyManual = async function() {
    var loc = nearbyInput.trim()
    if (!loc) return
    setNearbyPrompt(false)
    setNearbyInput("")
    setBusy("Looking up location...")
    setErr("")
    try {
      var raw = await callScout("What are the GPS coordinates of this location: " + loc + "? Return ONLY JSON: {\"lat\":number,\"lng\":number}")
      var coords = grabJSON(raw)
      if (!coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") throw new Error("Could not find that location")
      if (Array.isArray(coords)) coords = coords[0]
      await doNearbyWithCoords(coords.lat, coords.lng)
    } catch(e) {
      setErr("Location lookup failed: " + e.message)
      setBusy("")
    }
  }

  if (!authed) return (
    <div style={{ background: CL.bg, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FT, padding: 40 }}>
      <div style={{ width: "100%", maxWidth: 300 }}>
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <p style={{ fontSize: 28, margin: "0 0 8px", opacity: 0.6 }}>🔒</p>
          <h1 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: CL.wh, letterSpacing: "0.08em" }}>PROSPECT WALKER</h1>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: CL.mut }}>Enter password to continue</p>
        </div>
        <input
          type="password" value={pw}
          onChange={function(e) { setPw(e.target.value); setPwErr(false) }}
          onKeyDown={function(e) { if (e.key === "Enter") doLogin() }}
          placeholder="Password"
          autoFocus
          style={{ display: "block", width: "100%", background: CL.card, border: "1px solid " + (pwErr ? "#E8606A" : CL.border), borderRadius: 8, color: CL.wh, fontSize: 13, padding: "11px 14px", fontFamily: FT, outline: "none", boxSizing: "border-box", marginBottom: 10 }}
        />
        {pwErr && <p style={{ margin: "0 0 8px", fontSize: 10, color: "#E8606A" }}>Wrong password</p>}
        <button onClick={doLogin} style={{ display: "block", width: "100%", background: CL.acc, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, padding: "11px 0", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>Unlock</button>
      </div>
    </div>
  )

  if (loading) return <div style={{ background: CL.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FT }}><p style={{ color: CL.mut, fontSize: 12 }}>Loading...</p></div>

  if (busy) return (
    <div style={{ background: CL.bg, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FT, gap: 14, padding: 40 }}>
      <div style={{ width: 26, height: 26, border: "2px solid " + CL.border, borderTopColor: CL.acc, borderRadius: "50%", animation: "pw .7s linear infinite" }} />
      <p style={{ color: CL.mut, fontSize: 12, textAlign: "center" }}>{busy}</p>
      <p style={{ color: CL.dim, fontSize: 10 }}>15-30 seconds</p>
      <style>{`@keyframes pw{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  var ErrBox = err ? (
    <div style={{ background: "#3B1418", border: "1px solid #E8606A33", borderRadius: 6, padding: "8px 12px", marginBottom: 10 }}>
      <p style={{ margin: 0, fontSize: 10, color: "#E8606A", lineHeight: 1.4 }}>{err}</p>
      <button onClick={function() { setErr("") }} style={{ background: "none", border: "none", color: "#E8606A88", fontSize: 9, cursor: "pointer", fontFamily: FT, padding: "4px 0 0" }}>Dismiss</button>
    </div>
  ) : null

  // Feature 2: breadcrumb navigation
  var hdr = function() {
    var crumbs = []
    if (view === "pick") {
      crumbs.push({ label: "Home", action: function() { setView("home") } })
      crumbs.push({ label: pCity })
    } else if (view === "list" && city && nh) {
      crumbs.push({ label: "Home", action: function() { setNId(null); setView("home"); setErr(""); setWalkOrder([]) } })
      crumbs.push({ label: city.name, action: function() { setNId(null); setView("home"); setOpenCity(cId); setErr(""); setWalkOrder([]) } })
      crumbs.push({ label: nh.name })
    } else if (view === "form") {
      crumbs.push({ label: "Home", action: function() { setView("home"); setEId(null) } })
      if (city) crumbs.push({ label: city.name, action: function() { setView("home"); setOpenCity(cId); setEId(null) } })
      if (nh) crumbs.push({ label: nh.name, action: function() { setView("list"); setEId(null) } })
      crumbs.push({ label: eId ? "Edit" : "Add" })
    }
    return (
      <div style={{ background: CL.card, borderBottom: "1px solid " + CL.border, padding: "12px 16px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {view === "home" ? (
              <div>
                <h1 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: CL.wh, letterSpacing: "0.06em" }}>PROSPECT WALKER</h1>
                <p style={{ margin: "1px 0 0", fontSize: 9, color: CL.mut }}>Hypandra Consulting</p>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                {crumbs.map(function(c, i) {
                  var isLast = i === crumbs.length - 1
                  return (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {i > 0 && <span style={{ fontSize: 9, color: CL.dim }}>→</span>}
                      {isLast ? (
                        <span style={{ fontSize: 12, color: CL.wh, fontWeight: 600 }}>{c.label}</span>
                      ) : (
                        <button onClick={c.action} style={{ background: "none", border: "none", color: CL.acc, fontSize: 11, cursor: "pointer", padding: 0, fontFamily: FT, fontWeight: 500 }}>{c.label}</button>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {ok && <span style={{ fontSize: 10, color: ok === "✓" ? "#5DE4A5" : "#E8606A", fontWeight: 600 }}>{ok}</span>}
            {view === "home" && <button onClick={function() { setSearchOpen(true); setSearchQuery("") }} style={{ background: "none", border: "none", color: CL.dim, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FT, lineHeight: 1 }} title="Search">🔍</button>}
            <button onClick={function() { setTheme(theme === "dark" ? "light" : "dark") }} style={{ background: "none", border: "none", color: CL.dim, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FT, lineHeight: 1 }} title="Toggle theme">{theme === "dark" ? "☀️" : "🌙"}</button>
            <button onClick={doLogout} style={{ background: "none", border: "none", color: CL.dim, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FT, lineHeight: 1 }} title="Lock">🔒</button>
          </div>
        </div>
      </div>
    )
  }

  // Feature 17: pull-to-refresh handlers
  var pullHandlers = {
    onTouchStart: function(e) { if (window.scrollY === 0) pullStartY.current = e.touches[0].clientY; else pullStartY.current = null },
    onTouchMove: function(e) { if (pullStartY.current != null && !refreshing) { var d = e.touches[0].clientY - pullStartY.current; if (d > 0) setPullDist(Math.min(d, 100)); else { setPullDist(0); pullStartY.current = null } } },
    onTouchEnd: function() {
      if (pullDist > 60 && !refreshing) {
        setRefreshing(true)
        loadData().then(function(d) { if (d) setData(d); setRefreshing(false); setPullDist(0) }).catch(function() { setRefreshing(false); setPullDist(0) })
      } else { setPullDist(0) }
      pullStartY.current = null
    },
  }
  var PullIndicator = (pullDist > 0 || refreshing) ? (
    <div style={{ display: "flex", justifyContent: "center", padding: (refreshing ? 10 : Math.min(pullDist * 0.4, 20)) + "px 0", transition: refreshing ? "padding 0.2s" : "none" }}>
      {refreshing ? <div style={{ width: 18, height: 18, border: "2px solid " + CL.border, borderTopColor: CL.acc, borderRadius: "50%", animation: "pw .7s linear infinite" }} /> : <span style={{ fontSize: 14, color: CL.dim, transform: pullDist > 60 ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>↓</span>}
    </div>
  ) : null

  // ===== HOME =====
  if (view === "home") {
    var cities = Object.values(data.cities).sort(function(a, b) { return a.name.localeCompare(b.name) })
    return (
      <div style={{ background: CL.bg, minHeight: "100vh", fontFamily: FT, color: CL.text, maxWidth: 500, margin: "0 auto" }} onTouchStart={pullHandlers.onTouchStart} onTouchMove={pullHandlers.onTouchMove} onTouchEnd={pullHandlers.onTouchEnd}>
        {hdr()}
        {PullIndicator}
        {searchOpen && (function() {
          var results = []
          var q = searchQuery.toLowerCase().trim()
          if (q) {
            Object.keys(data.cities).forEach(function(cid) {
              var c = data.cities[cid]
              Object.keys(c.neighborhoods || {}).forEach(function(nid) {
                var n = c.neighborhoods[nid]
                Object.keys(n.prospects || {}).forEach(function(pid) {
                  var p = n.prospects[pid]
                  if (p.name.toLowerCase().indexOf(q) !== -1) {
                    results.push({ pid: pid, cId: cid, nId: nid, name: p.name, nhName: n.name, cityName: c.name })
                  }
                })
              })
            })
          }
          return (
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: CL.bg, zIndex: 25, fontFamily: FT, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid " + CL.border, display: "flex", gap: 8, alignItems: "center" }}>
                <input value={searchQuery} onChange={function(e) { setSearchQuery(e.target.value) }} autoFocus placeholder="Search businesses..." style={{ flex: 1, background: CL.card, border: "1px solid " + CL.border, borderRadius: 8, color: CL.wh, fontSize: 13, padding: "10px 12px", fontFamily: FT, outline: "none", boxSizing: "border-box" }} />
                <button onClick={function() { setSearchOpen(false); setSearchQuery("") }} style={{ background: "none", border: "none", color: CL.dim, fontSize: 14, cursor: "pointer", fontFamily: FT, padding: 4 }}>✕</button>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "8px 16px" }}>
                {q && results.length === 0 && <p style={{ fontSize: 11, color: CL.dim, textAlign: "center", marginTop: 30 }}>No results</p>}
                {results.map(function(r) {
                  return (
                    <button key={r.pid} onClick={function() { setCId(r.cId); setNId(r.nId); setView("list"); setExp(r.pid); setSearchHighlight(r.pid); setSearchOpen(false); setSearchQuery(""); setTimeout(function() { setSearchHighlight(null) }, 2000) }} style={{ display: "block", width: "100%", textAlign: "left", background: CL.card, border: "1px solid " + CL.border, borderRadius: 7, padding: "10px 12px", marginBottom: 4, cursor: "pointer", fontFamily: FT }}>
                      <span style={{ fontSize: 12, color: CL.wh, fontWeight: 600 }}>{r.name}</span>
                      <p style={{ margin: "2px 0 0", fontSize: 9, color: CL.mut }}>{r.nhName} · {r.cityName}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })()}
        <div style={{ padding: "16px 16px 100px" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
            <input value={input} onChange={function(e) { setInput(e.target.value) }} onKeyDown={function(e) { if (e.key === "Enter") doAddCity() }}
              placeholder="Enter a city..." style={{ flex: 1, background: CL.card, border: "1px solid " + CL.border, borderRadius: 8, color: CL.wh, fontSize: 13, padding: "10px 12px", fontFamily: FT, outline: "none", boxSizing: "border-box" }} />
            <button onClick={doAddCity} style={{ background: CL.acc, border: "none", borderRadius: 8, color: "#fff", fontSize: 11, padding: "10px 14px", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>+ City</button>
          </div>
          <button onClick={doNearby} style={{ display: "block", width: "100%", background: CL.card, border: "1px solid " + CL.border, borderRadius: nearbyPrompt ? "8px 8px 0 0" : 8, color: CL.text, fontSize: 11, padding: "10px 14px", cursor: "pointer", fontFamily: FT, fontWeight: 500, marginBottom: nearbyPrompt ? 0 : 20, textAlign: "center" }}>📍 Prospect Nearby</button>
          {nearbyPrompt && <div style={{ background: CL.card, border: "1px solid " + CL.border, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "10px 12px", marginBottom: 20 }}>
            <p style={{ margin: "0 0 8px", fontSize: 10, color: CL.mut }}>Can't get GPS. Where are you?</p>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={nearbyInput} onChange={function(e) { setNearbyInput(e.target.value) }} onKeyDown={function(e) { if (e.key === "Enter") doNearbyManual() }} placeholder="e.g. Cafe Ladro, Phinney Ridge" autoFocus style={{ flex: 1, background: CL.bg, border: "1px solid " + CL.border, borderRadius: 6, color: CL.wh, fontSize: 11, padding: "8px 10px", fontFamily: FT, outline: "none", boxSizing: "border-box" }} />
              <button onClick={doNearbyManual} style={{ background: CL.acc, border: "none", borderRadius: 6, color: "#fff", fontSize: 10, padding: "8px 12px", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>Go</button>
              <button onClick={function() { setNearbyPrompt(false); setNearbyInput("") }} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 6, color: CL.dim, fontSize: 10, padding: "8px 8px", cursor: "pointer", fontFamily: FT }}>✕</button>
            </div>
          </div>}
          {ErrBox}
          {cities.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 20px", color: CL.dim }}>
              <p style={{ fontSize: 24, margin: "0 0 10px", opacity: 0.5 }}>📍</p>
              <p style={{ fontSize: 12, margin: 0 }}>Add a city to start prospecting</p>
              <p style={{ fontSize: 10, margin: "8px auto 0", lineHeight: 1.5, maxWidth: 280 }}>Find businesses by neighborhood, build walking routes</p>
            </div>
          ) : cities.map(function(c) {
            var nhs = Object.values(c.neighborhoods || {})
            var tp = nhs.reduce(function(s, n) { return s + Object.keys(n.prospects || {}).length }, 0)
            var tv = nhs.reduce(function(s, n) { return s + Object.values(n.prospects || {}).filter(function(p) { return p.status === "visited" || p.status === "interested" }).length }, 0)
            var op = openCity === c.id
            return (
              <div key={c.id} style={{ marginBottom: 6 }}>
                <button onClick={function() { setOpenCity(op ? null : c.id) }} style={{ display: "block", width: "100%", textAlign: "left", background: CL.card, border: "1px solid " + (op ? CL.bL : CL.border), borderRadius: op ? "8px 8px 0 0" : 8, padding: "12px 14px", cursor: "pointer", fontFamily: FT }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ margin: 0, fontSize: 13, color: CL.wh, fontWeight: 600 }}>{c.name}</h3>
                    <span style={{ fontSize: 9, color: CL.dim }}>{nhs.length} areas · {tp} prospects {op ? "▾" : "▸"}</span>
                  </div>
                  {tp > 0 && <div style={{ display: "flex", gap: 10, marginTop: 6, alignItems: "center" }}><div style={{ flex: 1, height: 3, background: CL.border, borderRadius: 2, overflow: "hidden" }}><div style={{ width: (tp ? (tv / tp) * 100 : 0) + "%", height: "100%", background: "#5DE4A5", borderRadius: 2 }} /></div><span style={{ fontSize: 9, color: "#5DE4A5" }}>{tv}/{tp}</span></div>}
                </button>
                {op && <div style={{ background: CL.card, border: "1px solid " + CL.bL, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "6px 8px 10px" }}>
                  {nhs.sort(function(a, b) { return a.name.localeCompare(b.name) }).map(function(n) {
                    var s = st(n)
                    return <button key={n.id} onClick={function() { setCId(c.id); setNId(n.id); setView("list"); setFilt("all"); setExp(null); setErr(""); setWalkOrder([]) }} style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: CL.bg, border: "1px solid " + CL.border, borderLeft: "2px solid " + (s.total === 0 ? CL.dim : CL.acc), borderRadius: 6, padding: "9px 12px", marginBottom: 3, cursor: "pointer", fontFamily: FT, textAlign: "left" }}>
                      <span style={{ fontSize: 11, color: CL.wh, fontWeight: 500 }}>{n.name}</span>
                      <div style={{ display: "flex", gap: 3 }}>
                        {s.interested > 0 && <span style={{ fontSize: 8, color: STATUS.interested.color, background: STATUS.interested.bg, padding: "1px 5px", borderRadius: 3, fontWeight: 600, fontFamily: FT }}>★{s.interested}</span>}
                        {s.goBack > 0 && <span style={{ fontSize: 8, color: STATUS.go_back.color, background: STATUS.go_back.bg, padding: "1px 5px", borderRadius: 3, fontWeight: 600, fontFamily: FT }}>↻{s.goBack}</span>}
                        {s.visited > 0 && <span style={{ fontSize: 8, color: STATUS.visited.color, background: STATUS.visited.bg, padding: "1px 5px", borderRadius: 3, fontWeight: 600, fontFamily: FT }}>✓{s.visited}</span>}
                        {s.notVis > 0 && <span style={{ fontSize: 8, color: STATUS.not_visited.color, background: STATUS.not_visited.bg, padding: "1px 5px", borderRadius: 3, fontWeight: 600, fontFamily: FT }}>○{s.notVis}</span>}
                        {s.total === 0 && <span style={{ fontSize: 8, color: CL.dim }}>find →</span>}
                      </div>
                    </button>
                  })}
                  {addNhCity === c.id ? (
                    <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                      <input value={addNhInput} onChange={function(e) { setAddNhInput(e.target.value) }} onKeyDown={function(e) { if (e.key === "Enter" && addNhInput.trim()) { var nid = uid(); deepSet(function(d) { d.cities[c.id].neighborhoods[nid] = { id: nid, name: addNhInput.trim(), description: "", prospects: {} } }); setAddNhInput(""); setAddNhCity(null) } if (e.key === "Escape") { setAddNhCity(null); setAddNhInput("") } }} autoFocus placeholder="Neighborhood name..." style={{ flex: 1, background: CL.bg, border: "1px solid " + CL.border, borderRadius: 5, color: CL.wh, fontSize: 11, padding: "7px 10px", fontFamily: FT, outline: "none", boxSizing: "border-box" }} />
                      <button onClick={function() { if (!addNhInput.trim()) return; var nid = uid(); deepSet(function(d) { d.cities[c.id].neighborhoods[nid] = { id: nid, name: addNhInput.trim(), description: "", prospects: {} } }); setAddNhInput(""); setAddNhCity(null) }} style={{ background: CL.acc, border: "none", borderRadius: 5, color: "#fff", fontSize: 10, padding: "7px 10px", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>Add</button>
                      <button onClick={function() { setAddNhCity(null); setAddNhInput("") }} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 5, color: CL.dim, fontSize: 10, padding: "7px 8px", cursor: "pointer", fontFamily: FT }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                      <button onClick={function() { setAddNhCity(c.id); setAddNhInput("") }} style={{ flex: 1, background: "none", border: "1px dashed " + CL.border, borderRadius: 6, color: CL.dim, fontSize: 10, padding: "7px 12px", cursor: "pointer", fontFamily: FT, textAlign: "center" }}>+ Neighborhood</button>
                      {tp > 0 && <button onClick={function() { var all = []; nhs.forEach(function(n) { Object.values(n.prospects || {}).forEach(function(p) { all.push(Object.assign({}, p, { _neighborhood: n.name, _city: c.name })) }) }); toCSV(all, true) }} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 6, color: CL.dim, fontSize: 10, padding: "7px 10px", cursor: "pointer", fontFamily: FT }}>CSV</button>}
                      <button onClick={function() { if (confirm("Delete " + c.name + " and all its neighborhoods?")) { deepSet(function(d) { delete d.cities[c.id] }); setOpenCity(null) } }} style={{ background: "none", border: "1px solid #E8606A22", borderRadius: 6, color: "#E8606A88", fontSize: 10, padding: "7px 10px", cursor: "pointer", fontFamily: FT }}>🗑</button>
                    </div>
                  )}
                </div>}
              </div>
            )
          })}
          {Object.keys(data.cities).length > 0 && <div style={{ marginTop: 30, display: "flex", gap: 8 }}>
            <button onClick={function() { var allP = []; Object.values(data.cities).forEach(function(c) { Object.values(c.neighborhoods || {}).forEach(function(n) { Object.values(n.prospects || {}).forEach(function(p) { allP.push(Object.assign({}, p, { _neighborhood: n.name, _city: c.name })) }) }) }); if (allP.length > 0) toCSV(allP, true, "prospect-walker-export.csv") }} style={{ flex: 1, background: "none", border: "1px solid " + CL.border, borderRadius: 8, color: CL.mut, fontSize: 10, padding: "10px 14px", cursor: "pointer", fontFamily: FT, textAlign: "center" }}>Export All CSV</button>
            <button onClick={function() { if (confirm("Clear ALL prospect data? This cannot be undone.")) { persist({ cities: {} }) } }} style={{ flex: 1, background: "none", border: "1px solid #E8606A22", borderRadius: 8, color: "#E8606A66", fontSize: 10, padding: "10px 14px", cursor: "pointer", fontFamily: FT, textAlign: "center" }}>Clear All Data</button>
          </div>}
        </div>
      </div>
    )
  }

  // ===== PICK NEIGHBORHOODS =====
  if (view === "pick") {
    return (
      <div style={{ background: CL.bg, minHeight: "100vh", fontFamily: FT, color: CL.text, maxWidth: 500, margin: "0 auto" }}>
        {hdr()}
        <div style={{ padding: "12px 16px 100px" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button onClick={function() { setSel(new Set(nhPick.map(function(_, i) { return i }))) }} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 5, color: CL.mut, fontSize: 9, padding: "4px 8px", cursor: "pointer", fontFamily: FT }}>All</button>
            <button onClick={function() { setSel(new Set()) }} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 5, color: CL.mut, fontSize: 9, padding: "4px 8px", cursor: "pointer", fontFamily: FT }}>None</button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: CL.acc }}>{sel.size} selected</span>
          </div>
          {nhPick.map(function(n, i) {
            var s = sel.has(i)
            return <button key={i} onClick={function() { var x = new Set(sel); if (s) x.delete(i); else x.add(i); setSel(x) }} style={{ display: "flex", width: "100%", textAlign: "left", alignItems: "center", gap: 10, background: s ? CL.accBg : CL.card, border: "1px solid " + (s ? CL.acc + "44" : CL.border), borderRadius: 7, padding: "10px 12px", marginBottom: 4, cursor: "pointer", fontFamily: FT }}>
              <span style={{ width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", background: s ? CL.acc : "transparent", border: "1.5px solid " + (s ? CL.acc : CL.bL), color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{s ? "✓" : ""}</span>
              <div><span style={{ fontSize: 11, color: CL.wh, fontWeight: 500 }}>{n.name}</span>{n.description && <p style={{ margin: "1px 0 0", fontSize: 9, color: CL.mut, lineHeight: 1.3 }}>{n.description}</p>}</div>
            </button>
          })}
          {sel.size > 0 && <button onClick={doConfirmNHs} style={{ display: "block", width: "100%", background: CL.acc, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, padding: "11px 0", cursor: "pointer", fontFamily: FT, fontWeight: 600, marginTop: 12, position: "sticky", bottom: 12 }}>Add {sel.size} Neighborhood{sel.size !== 1 ? "s" : ""}</button>}
        </div>
      </div>
    )
  }

  // ===== PROSPECT LIST =====
  if (view === "list" && nh) {
    var all = Object.values(nh.prospects || {})
    var shown = all.filter(function(p) { return filt === "all" || p.status === filt }).sort(function(a, b) {
      var w = { unknown: -1, poor: 0, weak: 1, decent: 2, strong: 3 }
      var wa = w[a.webScore] != null ? w[a.webScore] : -1
      var wb = w[b.webScore] != null ? w[b.webScore] : -1
      var d = wa - wb
      return d !== 0 ? d : (STATUS[a.status] || {}).sort - (STATUS[b.status] || {}).sort
    })
    var prospectMap = {}
    all.forEach(function(p) { prospectMap[p.id] = p })
    var walkable = walkOrder.map(function(id) { return prospectMap[id] }).filter(Boolean)
    var mUrl = walkable.length >= 1 ? makeWalkUrl(walkable, startFromHere ? userCoords : null) : null

    var toggleWalk = function(pid) {
      if (walkSelSet.has(pid)) setWalkOrder(walkOrder.filter(function(id) { return id !== pid }))
      else setWalkOrder(walkOrder.concat([pid]))
    }
    var selAllShown = function() {
      var ids = shown.filter(function(p) { return p.address }).map(function(p) { return p.id })
      setWalkOrder(ids)
    }
    var clearSel = function() { setWalkOrder([]) }

    return (
      <div style={{ background: CL.bg, minHeight: "100vh", fontFamily: FT, color: CL.text, maxWidth: 500, margin: "0 auto" }} onTouchStart={pullHandlers.onTouchStart} onTouchMove={pullHandlers.onTouchMove} onTouchEnd={pullHandlers.onTouchEnd}>
        {hdr()}
        {PullIndicator}
        <div style={{ padding: "12px 16px 100px" }}>
          <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
            <button onClick={doScout} style={{ flex: 1, background: CL.warnBg, border: "1px solid " + CL.warn + "33", borderRadius: 7, color: CL.warn, fontSize: 10, padding: "8px 10px", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>🔍 Find Businesses</button>
            {all.length > 0 && <button onClick={function() { toCSV(all.map(function(p) { return Object.assign({}, p, { _neighborhood: nh.name, _city: city.name }) }), false) }} style={{ background: CL.card, border: "1px solid " + CL.border, borderRadius: 7, color: CL.mut, fontSize: 10, padding: "8px 10px", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>CSV</button>}
            {mUrl && <a href={mUrl} target="_blank" rel="noopener noreferrer" style={{ flex: 1, background: CL.accBg, border: "1px solid " + CL.acc + "33", borderRadius: 7, color: CL.acc, fontSize: 10, padding: "8px 10px", fontFamily: FT, fontWeight: 600, textDecoration: "none", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>🗺 Walk ({walkable.length})</a>}
          </div>
          {walkOrder.length > 0 && <div ref={walkListRef} style={{ background: CL.card, border: "1px solid " + CL.border, borderRadius: 7, padding: "6px 0", marginBottom: 8 }}>
            <div style={{ padding: "0 10px 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Walk Order</span>
              <span style={{ fontSize: 8, color: CL.dim }}>drag to reorder</span>
            </div>
            {walkOrder.map(function(pid, i) {
              var wp = prospectMap[pid]
              if (!wp) return null
              return (
                <div key={pid} draggable style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
                  background: dragIdx === i ? CL.accBg : dragOverIdx === i ? CL.bg : "transparent",
                  opacity: dragIdx === i ? 0.6 : 1,
                  borderTop: dragOverIdx === i ? "2px solid " + CL.acc : "none",
                  cursor: "grab", userSelect: "none",
                }}
                  onDragStart={function(e) { setDragIdx(i); e.dataTransfer.effectAllowed = "move" }}
                  onDragOver={function(e) { e.preventDefault(); setDragOverIdx(i) }}
                  onDragEnd={function() {
                    if (dragIdx != null && dragOverIdx != null && dragIdx !== dragOverIdx) {
                      var newOrder = walkOrder.slice()
                      var item = newOrder.splice(dragIdx, 1)[0]
                      newOrder.splice(dragOverIdx, 0, item)
                      setWalkOrder(newOrder)
                    }
                    setDragIdx(null); setDragOverIdx(null)
                  }}
                  onTouchStart={function(e) {
                    var touch = e.touches[0]
                    setDragIdx(i)
                    walkListRef._touchY = touch.clientY
                    walkListRef._touchIdx = i
                  }}
                  onTouchMove={function(e) {
                    if (walkListRef._touchIdx == null) return
                    e.preventDefault()
                    var touch = e.touches[0]
                    var el = walkListRef.current
                    if (!el) return
                    var items = el.querySelectorAll("[draggable]")
                    for (var j = 0; j < items.length; j++) {
                      var rect = items[j].getBoundingClientRect()
                      if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) { setDragOverIdx(j); break }
                    }
                  }}
                  onTouchEnd={function() {
                    if (walkListRef._touchIdx != null && dragOverIdx != null && walkListRef._touchIdx !== dragOverIdx) {
                      var newOrder = walkOrder.slice()
                      var item = newOrder.splice(walkListRef._touchIdx, 1)[0]
                      newOrder.splice(dragOverIdx, 0, item)
                      setWalkOrder(newOrder)
                    }
                    setDragIdx(null); setDragOverIdx(null)
                    walkListRef._touchIdx = null
                  }}
                >
                  <span style={{ fontSize: 11, color: CL.dim, cursor: "grab", flexShrink: 0 }}>≡</span>
                  <span style={{ fontSize: 10, color: CL.wh, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i + 1}. {wp.name}</span>
                  <button onClick={function(e) { e.stopPropagation(); setWalkOrder(walkOrder.filter(function(id) { return id !== pid })) }} style={{ background: "none", border: "none", color: CL.dim, fontSize: 10, cursor: "pointer", padding: "2px 4px", fontFamily: FT, flexShrink: 0 }}>✕</button>
                </div>
              )
            })}
          </div>}
          {lastScoutCount !== null && <div style={{ background: CL.accBg, border: "1px solid " + CL.acc + "22", borderRadius: 5, padding: "5px 10px", marginBottom: 8 }}><p style={{ margin: 0, fontSize: 10, color: CL.acc }}>{lastScoutCount.total} found{lastScoutCount.skipped > 0 ? ", " + lastScoutCount.skipped + " duplicate" + (lastScoutCount.skipped !== 1 ? "s" : "") + " skipped" : ""}, {lastScoutCount.added} added</p></div>}
          <div style={{ display: "flex", gap: 5, marginBottom: 8, alignItems: "center" }}>
            <button onClick={selAllShown} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 5, color: CL.mut, fontSize: 9, padding: "4px 8px", cursor: "pointer", fontFamily: FT }}>☑ Select All</button>
            {walkOrder.length > 0 && <button onClick={clearSel} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 5, color: CL.mut, fontSize: 9, padding: "4px 8px", cursor: "pointer", fontFamily: FT }}>Clear ({walkOrder.length})</button>}
            <span style={{ flex: 1 }} />
            {userCoords && <button onClick={function() { setStartFromHere(!startFromHere) }} style={{ background: startFromHere ? CL.accBg : "transparent", border: "1px solid " + (startFromHere ? CL.acc + "44" : CL.border), borderRadius: 5, color: startFromHere ? CL.acc : CL.dim, fontSize: 9, padding: "4px 8px", cursor: "pointer", fontFamily: FT }}>📍 From me</button>}
          </div>
          <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
            <button onClick={function() { setForm({ name: "", address: "", type: "", webScore: "unknown", currentWebsite: "", contact: "", notes: "", status: "not_visited" }); setEId(null); setView("form") }} style={{ background: CL.card, border: "1px solid " + CL.border, borderRadius: 7, color: CL.text, fontSize: 10, padding: "7px 10px", cursor: "pointer", fontFamily: FT }}>+ Manual</button>
            {walkOrder.length > 0 && <button onClick={function() { if (confirm("Delete " + walkOrder.length + " selected business" + (walkOrder.length !== 1 ? "es" : "") + "?")) { deepSet(function(d) { walkOrder.forEach(function(pid) { delete d.cities[cId].neighborhoods[nId].prospects[pid] }) }); setWalkOrder([]); setExp(null) } }} style={{ background: "#3B1418", border: "1px solid #E8606A33", borderRadius: 7, color: "#E8606A", fontSize: 10, padding: "7px 10px", cursor: "pointer", fontFamily: FT }}>🗑 Delete ({walkOrder.length})</button>}
          </div>
          {ErrBox}
          <div style={{ display: "flex", gap: 3, marginBottom: 12, flexWrap: "wrap" }}>
            {["all", "not_visited", "go_back", "interested", "visited", "not_interested"].map(function(f) {
              var n = f === "all" ? all.length : all.filter(function(p) { return p.status === f }).length
              var s = STATUS[f]
              return <button key={f} onClick={function() { setFilt(f) }} style={{ background: filt === f ? (s ? s.bg : CL.card) : "transparent", border: "1px solid " + (filt === f ? (s ? s.color : CL.mut) + "33" : "transparent"), borderRadius: 4, color: s ? s.color : CL.mut, fontSize: 8, padding: "6px 10px", minHeight: 36, cursor: "pointer", fontFamily: FT, opacity: filt === f ? 1 : 0.5 }}>{f === "all" ? "ALL " + n : s.icon + n}</button>
            })}
          </div>
          {shown.length === 0 ? (
            all.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: CL.dim }}>
              <p style={{ fontSize: 20, margin: "0 0 8px", opacity: 0.5 }}>🏪</p>
              <p style={{ fontSize: 13, margin: "0 0 6px", color: CL.wh, fontWeight: 600 }}>No businesses yet</p>
              <p style={{ fontSize: 10, margin: "0 0 14px", color: CL.mut, lineHeight: 1.5 }}>Tap Find Businesses to scout this area, or + Quick Add to enter one manually.</p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button onClick={doScout} style={{ background: CL.warnBg, border: "1px solid " + CL.warn + "33", borderRadius: 7, color: CL.warn, fontSize: 10, padding: "8px 14px", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>🔍 Find Businesses</button>
                <button onClick={function() { setQuickAdd(true); setQuickName("") }} style={{ background: CL.card, border: "1px solid " + CL.border, borderRadius: 7, color: CL.text, fontSize: 10, padding: "8px 14px", cursor: "pointer", fontFamily: FT, fontWeight: 500 }}>+ Quick Add</button>
              </div>
            </div>
            ) : (
            <div style={{ textAlign: "center", padding: "40px 20px", color: CL.dim }}><p style={{ fontSize: 11 }}>No matches</p></div>
            )
          ) : shown.map(function(p) {
            var sc = STATUS[p.status]
            var ws = WS[p.webScore] || WS.unknown
            var op = exp === p.id
            var phoneMatch = (p.contact || "").match(PHONE_RE)
            return (
              <div key={p.id} style={{ position: "relative", background: CL.card, borderLeft: "3px solid " + ws.color, border: "1px solid " + (op ? sc.color + "33" : searchHighlight === p.id ? CL.acc : CL.border), borderLeftWidth: 3, borderLeftColor: ws.color, borderRadius: 7, marginBottom: 5, overflow: "hidden", transition: "border-color 0.3s" }}>
                {statusFlash && statusFlash.pid === p.id && <div style={{ position: "absolute", top: 4, right: 8, background: CL.card, border: "1px solid " + CL.acc + "44", borderRadius: 5, padding: "4px 10px", zIndex: 5 }}><span style={{ fontSize: 9, color: CL.acc, fontWeight: 600, fontFamily: FT }}>{statusFlash.label}</span></div>}
                <div style={{ display: "flex", alignItems: "center" }}>
                  <button onClick={function(e) { e.stopPropagation(); toggleWalk(p.id) }} style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 4px 10px 10px", display: "flex", alignItems: "center", flexShrink: 0 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", background: walkSelSet.has(p.id) ? CL.acc : "transparent", border: "1.5px solid " + (walkSelSet.has(p.id) ? CL.acc : CL.bL), color: "#fff", fontSize: 10, fontWeight: 700 }}>{walkSelSet.has(p.id) ? "✓" : ""}</span>
                  </button>
                  <button
                    onClick={function() { if (longPressTriggered.current || swipeTriggered.current) { longPressTriggered.current = false; swipeTriggered.current = false; return } setExp(op ? null : p.id) }}
                    onTouchStart={function(e) {
                      longPressTriggered.current = false
                      swipeTriggered.current = false
                      swipeStartX.current = e.touches[0].clientX
                      swipeStartY.current = e.touches[0].clientY
                      longPressTimer.current = setTimeout(function() {
                        longPressTriggered.current = true
                        var next = nextStatus(p.status)
                        doUpdateP(p.id, { status: next })
                        setStatusFlash({ pid: p.id, label: STATUS[next].icon + " " + STATUS[next].label })
                        setTimeout(function() { setStatusFlash(null) }, 1200)
                      }, 500)
                    }}
                    onTouchEnd={function(e) {
                      clearTimeout(longPressTimer.current)
                      if (swipeStartX.current != null) {
                        var deltaX = e.changedTouches[0].clientX - swipeStartX.current
                        if (deltaX > 50) { swipeTriggered.current = true; var next = nextStatus(p.status); doUpdateP(p.id, { status: next }); setStatusFlash({ pid: p.id, label: STATUS[next].icon + " " + STATUS[next].label }); setTimeout(function() { setStatusFlash(null) }, 1200) }
                        else if (deltaX < -50) { swipeTriggered.current = true; setEId(p.id); setForm({ name: p.name, address: p.address || "", type: p.type || "", webScore: p.webScore || "unknown", currentWebsite: p.currentWebsite || "", contact: p.contact || "", notes: p.notes || "", status: p.status }); setView("form") }
                      }
                      swipeStartX.current = null; swipeStartY.current = null
                    }}
                    onTouchMove={function(e) {
                      if (swipeStartX.current == null) return
                      var deltaX = Math.abs(e.touches[0].clientX - swipeStartX.current)
                      var deltaY = Math.abs(e.touches[0].clientY - swipeStartY.current)
                      if (deltaX > 10) clearTimeout(longPressTimer.current)
                      if (deltaY > 10) { clearTimeout(longPressTimer.current); swipeStartX.current = null; swipeStartY.current = null }
                    }}
                    style={{ display: "flex", flex: 1, justifyContent: "space-between", alignItems: "center", padding: "10px 12px 10px 4px", background: "none", border: "none", cursor: "pointer", fontFamily: FT, textAlign: "left", gap: 6 }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: CL.wh, fontWeight: 600 }}>{p.name}</span>
                        <span style={{ fontSize: 7, color: ws.color, background: ws.bg, padding: "2px 6px", borderRadius: 3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FT }}>{ws.label}</span>
                      </div>
                      {p.type && <p style={{ margin: "1px 0 0", fontSize: 9, color: CL.dim }}>{p.type}{p.address ? " · " + p.address : ""}</p>}
                    </div>
                    <span style={{ fontSize: 7, color: sc.color, background: sc.bg, padding: "2px 6px", borderRadius: 3, textTransform: "uppercase", fontWeight: 700, fontFamily: FT, whiteSpace: "nowrap" }}>{sc.icon} {sc.label}</span>
                  </button>
                </div>
                {op && <div style={{ padding: "0 12px 10px", borderTop: "1px solid " + CL.border }}>
                  <div style={{ marginTop: 8 }}>
                    <span style={{ fontSize: 7, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Web Presence</span>
                    <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                      {["poor", "weak", "decent", "strong"].map(function(k) { var v = WS[k]; return <button key={k} onClick={function() { doUpdateP(p.id, { webScore: k }) }} style={{ background: p.webScore === k ? v.bg : "transparent", border: "1px solid " + (p.webScore === k ? v.color + "44" : CL.border), borderRadius: 4, color: p.webScore === k ? v.color : CL.dim, fontSize: 9, padding: "6px 10px", minHeight: 36, cursor: "pointer", fontFamily: FT }}>{v.label}</button> })}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {p.address && <a href={"https://www.google.com/maps/dir/?api=1" + (userCoords ? "&origin=" + userCoords.lat + "," + userCoords.lng : "") + "&destination=" + encodeURIComponent(p.address) + "&travelmode=walking"} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: CL.acc, textDecoration: "none", padding: "6px 10px", minHeight: 36, display: "flex", alignItems: "center" }}>🧭 Directions</a>}
                    <a href={"https://www.google.com/search?" + new URLSearchParams({ q: p.name + " " + p.address })} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: CL.acc, textDecoration: "none", padding: "6px 10px", minHeight: 36, display: "flex", alignItems: "center" }}>🔍 Google it</a>
                    {p.currentWebsite && <a href={p.currentWebsite} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: CL.acc, textDecoration: "none", padding: "6px 10px", minHeight: 36, display: "flex", alignItems: "center" }}>🔗 Website</a>}
                    {phoneMatch && <a href={"tel:" + phoneMatch[1].replace(/[^\d+]/g, "")} style={{ fontSize: 9, color: CL.acc, textDecoration: "none", padding: "6px 10px", minHeight: 36, display: "flex", alignItems: "center" }}>📞 Call</a>}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <span style={{ fontSize: 7, color: "#60B8F7", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Contact</span>
                    <input key={p.id + "-contact"} defaultValue={p.contact || ""} onBlur={function(e) { var v = e.target.value.trim(); if (v !== (p.contact || "")) doUpdateP(p.id, { contact: v }) }} placeholder="Name, phone, email..." style={{ display: "block", width: "100%", background: CL.bg, border: "1px solid " + CL.border, borderRadius: 5, color: CL.wh, fontSize: 10, padding: "6px 8px", marginTop: 3, fontFamily: FT, boxSizing: "border-box", outline: "none" }} />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <span style={{ fontSize: 7, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Notes</span>
                    <textarea key={p.id + "-notes"} defaultValue={p.notes || ""} onBlur={function(e) { var v = e.target.value.trim(); if (v !== (p.notes || "")) doUpdateP(p.id, { notes: v }) }} placeholder="Add notes..." rows={2} style={{ display: "block", width: "100%", background: CL.bg, border: "1px solid " + CL.border, borderRadius: 5, color: CL.wh, fontSize: 10, padding: "6px 8px", marginTop: 3, fontFamily: FT, boxSizing: "border-box", resize: "vertical", outline: "none" }} />
                  </div>
                  {p.visitedAt && <p style={{ margin: "6px 0 0", fontSize: 8, color: CL.dim }}>Visited {new Date(p.visitedAt).toLocaleDateString()}</p>}
                  <label onClick={function(e) { e.stopPropagation() }} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, cursor: "pointer", userSelect: "none" }}>
                    <input type="checkbox" checked={!!p.emailed} onChange={function() { doUpdateP(p.id, { emailed: !p.emailed }) }} style={{ accentColor: CL.acc, width: 22, height: 22, cursor: "pointer" }} />
                    <span style={{ fontSize: 10, color: p.emailed ? CL.acc : CL.mut }}>Emailed</span>
                  </label>
                  <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {Object.keys(STATUS).map(function(k) { var v = STATUS[k]; return <button key={k} onClick={function() { doUpdateP(p.id, { status: k }) }} style={{ background: p.status === k ? v.bg : "transparent", border: "1px solid " + (p.status === k ? v.color + "44" : CL.border), borderRadius: 4, color: p.status === k ? v.color : CL.dim, fontSize: 9, padding: "6px 10px", minHeight: 36, cursor: "pointer", fontFamily: FT }}>{v.icon}</button> })}
                    <span style={{ flex: 1 }} />
                    <button onClick={function() { setWalkOrder(walkOrder.filter(function(id) { return id !== p.id })); deepSet(function(d) { var n = d.cities[cId].neighborhoods[nId]; if (!n.blocklist) n.blocklist = []; n.blocklist.push(p.name.toLowerCase().trim()); delete n.prospects[p.id] }); setExp(null) }} style={{ background: "none", border: "1px solid #E8606A33", borderRadius: 4, color: "#E8606A88", fontSize: 9, padding: "6px 10px", minHeight: 36, cursor: "pointer", fontFamily: FT }}>🚫 Fake</button>
                    <button onClick={function() { if (confirm("Delete " + p.name + "?")) { setWalkOrder(walkOrder.filter(function(id) { return id !== p.id })); deepSet(function(d) { delete d.cities[cId].neighborhoods[nId].prospects[p.id] }); setExp(null) } }} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 4, color: CL.dim, fontSize: 9, padding: "6px 10px", minHeight: 36, cursor: "pointer", fontFamily: FT }}>🗑</button>
                    <button onClick={function() { setEId(p.id); setForm({ name: p.name, address: p.address || "", type: p.type || "", webScore: p.webScore || "unknown", currentWebsite: p.currentWebsite || "", contact: p.contact || "", notes: p.notes || "", status: p.status }); setView("form") }} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 4, color: CL.mut, fontSize: 9, padding: "6px 10px", minHeight: 36, cursor: "pointer", fontFamily: FT }}>Edit</button>
                  </div>
                </div>}
              </div>
            )
          })}
        </div>
        {quickAdd ? <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: CL.card, borderTop: "2px solid " + CL.acc, padding: 16, zIndex: 30, maxWidth: 500, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: CL.wh, fontWeight: 600 }}>Quick Add</span>
            <button onClick={function() { setQuickAdd(false) }} style={{ background: "none", border: "none", color: CL.dim, fontSize: 14, cursor: "pointer", fontFamily: FT, padding: 0 }}>✕</button>
          </div>
          <input value={quickName} onChange={function(e) { setQuickName(e.target.value) }} onKeyDown={function(e) { if (e.key === "Enter" && quickName.trim()) { doAddP({ name: quickName.trim(), address: userCoords ? userCoords.lat + "," + userCoords.lng : "", type: "", webScore: "unknown", currentWebsite: null, notes: "", status: "not_visited" }); setQuickAdd(false); setQuickName("") } }} autoFocus placeholder="Business name..." style={{ display: "block", width: "100%", background: CL.bg, border: "1px solid " + CL.border, borderRadius: 6, color: CL.wh, fontSize: 13, padding: "10px 12px", fontFamily: FT, outline: "none", boxSizing: "border-box", marginBottom: 8 }} />
          {userCoords && <p style={{ margin: "0 0 8px", fontSize: 9, color: CL.dim }}>📍 Will use current location as address</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={function() { if (!quickName.trim()) return; doAddP({ name: quickName.trim(), address: userCoords ? userCoords.lat + "," + userCoords.lng : "", type: "", webScore: "unknown", currentWebsite: null, notes: "", status: "not_visited" }); setQuickAdd(false); setQuickName("") }} style={{ flex: 1, background: CL.acc, border: "none", borderRadius: 7, color: "#fff", fontSize: 12, padding: "10px 0", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>Add</button>
            <button onClick={function() { setQuickAdd(false) }} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 7, color: CL.dim, fontSize: 12, padding: "10px 16px", cursor: "pointer", fontFamily: FT }}>Cancel</button>
          </div>
        </div> : walkOrder.length > 0 ? <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: CL.card, borderTop: "1px solid " + CL.border, padding: "10px 16px", zIndex: 20, maxWidth: 500, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: CL.wh, fontWeight: 600, whiteSpace: "nowrap" }}>{walkOrder.length} selected</span>
            <span style={{ fontSize: 9, color: CL.dim }}>Mark as:</span>
            {[["visited", "✓"], ["interested", "★"], ["go_back", "↻"], ["not_interested", "✕"]].map(function(pair) {
              var st = STATUS[pair[0]]
              return <button key={pair[0]} onClick={function() {
                deepSet(function(d) {
                  walkOrder.forEach(function(pid) {
                    var p = d.cities[cId].neighborhoods[nId].prospects[pid]
                    if (p) {
                      p.status = pair[0]
                      if ((pair[0] === "visited" || pair[0] === "interested") && !p.visitedAt) p.visitedAt = new Date().toISOString()
                    }
                  })
                })
                setWalkOrder([])
              }} style={{ background: st.bg, border: "1px solid " + st.color + "44", borderRadius: 5, color: st.color, fontSize: 12, padding: "8px 12px", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>{pair[1]}</button>
            })}
          </div>
        </div> : <button onClick={function() { setQuickAdd(true); setQuickName("") }} style={{ position: "fixed", bottom: 20, right: 20, background: CL.acc, border: "none", borderRadius: 24, color: "#fff", fontSize: 12, padding: "10px 16px", cursor: "pointer", fontFamily: FT, fontWeight: 600, boxShadow: "0 2px 12px rgba(79,142,247,0.4)", zIndex: 20 }}>+ Quick Add</button>}
      </div>
    )
  }

  // ===== ADD/EDIT FORM =====
  if (view === "form") {
    var isEd = !!eId
    return (
      <div style={{ background: CL.bg, minHeight: "100vh", fontFamily: FT, color: CL.text, maxWidth: 500, margin: "0 auto" }}>
        {hdr()}
        <div style={{ padding: "16px 16px 100px" }}>
          {[["name", "Business Name", "e.g. Capitol Hill Coffee"], ["address", "Address", "123 Pike St"], ["type", "Type", "coffee shop, salon..."], ["currentWebsite", "Website", "https://..."]].map(function(a) {
            return <div key={a[0]} style={{ marginBottom: 12 }}><span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{a[1]}</span><input value={form[a[0]] || ""} onChange={function(e) { var u = {}; u[a[0]] = e.target.value; setForm(Object.assign({}, form, u)) }} placeholder={a[2]} style={{ display: "block", width: "100%", background: CL.card, border: "1px solid " + CL.border, borderRadius: 6, color: CL.wh, fontSize: 12, padding: "9px 11px", marginTop: 3, fontFamily: FT, boxSizing: "border-box", outline: "none" }} /></div>
          })}
          {ErrBox}
          <div style={{ marginBottom: 12 }}><span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Web Presence</span><div style={{ display: "flex", gap: 5, marginTop: 4 }}>{Object.keys(WS).map(function(k) { var v = WS[k]; return <button key={k} onClick={function() { setForm(Object.assign({}, form, { webScore: k })) }} style={{ background: form.webScore === k ? v.bg : CL.card, border: "1px solid " + (form.webScore === k ? v.color + "55" : CL.border), borderRadius: 5, color: form.webScore === k ? v.color : CL.mut, fontSize: 10, padding: "5px 9px", cursor: "pointer", fontFamily: FT }}>{v.label}</button> })}</div></div>
          <div style={{ marginBottom: 12 }}><span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Contact Person</span><input value={form.contact || ""} onChange={function(e) { setForm(Object.assign({}, form, { contact: e.target.value })) }} placeholder="Name, role, phone..." style={{ display: "block", width: "100%", background: CL.card, border: "1px solid " + CL.border, borderRadius: 6, color: CL.wh, fontSize: 12, padding: "9px 11px", marginTop: 3, fontFamily: FT, boxSizing: "border-box", outline: "none" }} /></div>
          <div style={{ marginBottom: 12 }}><span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Notes</span><textarea value={form.notes || ""} onChange={function(e) { setForm(Object.assign({}, form, { notes: e.target.value })) }} placeholder="Who you talked to, follow-up..." rows={3} style={{ display: "block", width: "100%", background: CL.card, border: "1px solid " + CL.border, borderRadius: 6, color: CL.wh, fontSize: 11, padding: "9px 11px", marginTop: 3, fontFamily: FT, boxSizing: "border-box", resize: "vertical", outline: "none" }} /></div>
          <div style={{ marginBottom: 20 }}><span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Status</span><div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>{Object.keys(STATUS).map(function(k) { var v = STATUS[k]; return <button key={k} onClick={function() { setForm(Object.assign({}, form, { status: k })) }} style={{ background: form.status === k ? v.bg : CL.card, border: "1px solid " + (form.status === k ? v.color + "55" : CL.border), borderRadius: 5, color: form.status === k ? v.color : CL.mut, fontSize: 9, padding: "5px 8px", cursor: "pointer", fontFamily: FT }}>{v.icon} {v.label}</button> })}</div></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={function() {
              if (!form.name || !form.name.trim()) return
              var f = { name: form.name.trim(), address: (form.address || "").trim(), type: (form.type || "").trim(), webScore: form.webScore || "unknown", contact: (form.contact || "").trim(), notes: (form.notes || "").trim(), status: form.status || "not_visited", currentWebsite: cleanUrl(form.currentWebsite) }
              if (isEd) { doUpdateP(eId, f); setEId(null); setView("list") } else doAddP(f)
            }} style={{ flex: 1, background: CL.acc, border: "none", borderRadius: 7, color: "#fff", fontSize: 12, padding: "10px 0", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>Save</button>
            {isEd && <button onClick={function() { if (confirm("Delete?")) { doDelP(eId); setEId(null) } }} style={{ background: "#3B1418", border: "none", borderRadius: 7, color: "#E8606A", fontSize: 11, padding: "10px 14px", cursor: "pointer", fontFamily: FT }}>Delete</button>}
          </div>
        </div>
      </div>
    )
  }

  return null
}
