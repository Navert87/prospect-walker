import { useState, useEffect, useCallback } from "react"
import { loadData, saveData } from "./db"

const STATUS = {
  not_visited: { label: "Not Visited", color: "#7B8BA5", bg: "#1A2236", icon: "○", sort: 0 },
  visited: { label: "Visited", color: "#5DE4A5", bg: "#0D3B2A", icon: "✓", sort: 2 },
  interested: { label: "Interested", color: "#60B8F7", bg: "#0D2847", icon: "★", sort: 1 },
  go_back: { label: "Go Back", color: "#F5C542", bg: "#3D2E0A", icon: "↻", sort: 1 },
  not_interested: { label: "Not Interested", color: "#E8606A", bg: "#3B1418", icon: "✕", sort: 3 },
}

const WS = {
  poor: { label: "Poor", color: "#E8606A", bg: "#3B1418" },
  weak: { label: "Weak", color: "#F5C542", bg: "#3D2E0A" },
  decent: { label: "Decent", color: "#60B8F7", bg: "#0D2847" },
  strong: { label: "Strong", color: "#5DE4A5", bg: "#0D3B2A" },
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6)
function cleanUrl(u) { if (!u || typeof u !== "string" || !u.trim()) return null; u = u.trim(); if (u === "null" || u === "N/A" || u === "none") return null; if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u; return u }
const CL = { bg: "#0B1121", card: "#131B2E", border: "#1E2D4A", bL: "#2A3F65", text: "#D4DCE8", mut: "#6B7FA3", dim: "#3E5278", wh: "#F0F4F8", acc: "#4F8EF7", accBg: "#162044", warn: "#F5C542", warnBg: "#3D2E0A" }
const FT = "'Geist Mono','SF Mono','JetBrains Mono',ui-monospace,monospace"
const APP_PW = import.meta.env.VITE_APP_PASSWORD || ""
const LS_KEY = "pw_authed"

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
  var d = await r.json()
  if (d.error) throw new Error(d.error)
  return d.text
}

async function getNHs(city) {
  var raw = await callScout("List main neighborhoods in " + city + " with concentrations of small independent local businesses. NOT chains. ONLY return a JSON array, no other text or markdown. Each object: {\"name\":\"Name\",\"description\":\"one sentence\"}. 15-25 neighborhoods sorted by small business density.")
  var p = grabJSON(raw)
  if (!p || !Array.isArray(p)) throw new Error("Parse failed")
  return p
}

async function scoutBiz(nh, city) {
  var raw = await callScout("Search the web to find real, currently operating small independent businesses in " + nh + ", " + city + " within walking distance (roughly half-mile radius of the neighborhood center).\n\nFor each business you find, search for their website, Google Business listing, social media, and online reviews to evaluate their digital presence.\n\nI run Hypandra Consulting offering web development, AI integration, and digital consulting for small businesses.\n\nRules:\n- ONLY include businesses you verified exist by finding them in web search results\n- Every business must have a real street address you found online\n- NO chains or franchises\n- If you can't verify a business exists, leave it out — 5 verified is better than 15 guessed\n- Stay within the neighborhood, don't wander to other parts of the city\n\nFor each business, actually visit their website (if they have one) and check for: outdated design, no mobile responsiveness, no online booking/ordering, broken links, missing SSL. Check if they have Google Business listing, Yelp presence, social media accounts.\n\nReturn ONLY a JSON array, no other text:\n[{\"name\":\"Exact Name\",\"address\":\"Full street address\",\"type\":\"category\",\"webScore\":\"poor|weak|decent|strong\",\"issues\":[\"specific issue you found\"],\"talkingPoints\":[\"specific pitch idea based on their actual issues\"],\"currentWebsite\":\"https://actual-url.com or null\"}]\n\nSort by weakest web presence first.")
  var p = grabJSON(raw)
  if (!p || !Array.isArray(p)) throw new Error("Parse failed - try again")
  return p
}

async function identifyLocation(lat, lng) {
  var raw = await callScout("What is the most specific, commonly-used neighborhood name for GPS coordinates [" + lat + ", " + lng + "]? Use the local name residents and businesses would use (e.g. 'Capitol Hill' not 'Central Seattle', 'Fremont' not 'North Seattle'). Return ONLY a JSON object, no other text: {\"neighborhood\":\"Specific Neighborhood Name\",\"city\":\"City Name\"}")
  var p = grabJSON(raw)
  if (!p || !p.neighborhood || !p.city) throw new Error("Could not identify location")
  if (Array.isArray(p)) return p[0]
  return p
}

async function lookupBiz(name, nhName, cityName) {
  var raw = await callScout("Search the web for the business called '" + name + "' in " + nhName + ", " + cityName + ".\n\nSearch for their website, Google Business listing, social media, and online reviews. Actually visit their website if they have one and check for: outdated design, no mobile responsiveness, no online booking/ordering, broken links, missing SSL.\n\nIf you cannot verify this business exists via web search, return {\"notFound\":true}.\n\nIf verified, return a single JSON object, no other text:\n{\"address\":\"Full street address\",\"type\":\"category\",\"webScore\":\"poor|weak|decent|strong\",\"issues\":[\"specific issues you found\"],\"talkingPoints\":[\"specific pitch ideas based on their actual issues\"],\"currentWebsite\":\"https://actual-url.com or null\"}\n\nFor currentWebsite: only include a URL you actually found. If no website exists, use null.")
  var p = grabJSON(raw)
  if (!p) throw new Error("Parse failed")
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
  if (waypoints.length > 0) u += "&waypoints=optimize:true|" + waypoints.join("|")
  return u
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
  var [view, setView] = useState("home")
  var [cId, setCId] = useState(null)
  var [nId, setNId] = useState(null)
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
  var [walkSel, setWalkSel] = useState(new Set())
  var [lastScoutCount, setLastScoutCount] = useState(null)
  var [lookingUp, setLookingUp] = useState(false)
  var [addNhCity, setAddNhCity] = useState(null)
  var [addNhInput, setAddNhInput] = useState("")
  var [userCoords, setUserCoords] = useState(null)

  useEffect(function() {
    loadData().then(function(d) {
      if (d) setData(d)
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
    setBusy("Scouting " + nh.name + "..."); setErr("")
    try {
      var biz = await scoutBiz(nh.name, city.name)
      var addedCount = 0
      deepSet(function(d) {
        var pros = d.cities[cId].neighborhoods[nId].prospects
        var existing = Object.values(pros).map(function(p) { return p.name.toLowerCase().trim() })
        biz.forEach(function(b) {
          var bName = (b.name || "").toLowerCase().trim()
          if (!bName || existing.indexOf(bName) !== -1) return
          existing.push(bName)
          addedCount++
          var pid = uid()
          pros[pid] = {
            id: pid, name: b.name || "Unknown", address: b.address || "", type: b.type || "",
            webScore: b.webScore || "weak", issues: b.issues || [], talkingPoints: b.talkingPoints || [],
            currentWebsite: cleanUrl(b.currentWebsite), status: "not_visited", notes: "",
            contact: "", visitedAt: null,
          }
        })
      })
      setLastScoutCount(addedCount)
      setTimeout(function() { setLastScoutCount(null) }, 5000)
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
      d.cities[cId].neighborhoods[nId].prospects[pid] = Object.assign({ id: pid, issues: [], talkingPoints: [], contact: "", visitedAt: null }, f)
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

  var doLookup = async function() {
    if (!form.name || !form.name.trim() || !nh || !city) return
    setLookingUp(true); setErr("")
    try {
      var result = await lookupBiz(form.name.trim(), nh.name, city.name)
      if (result.notFound) {
        setErr("Business not found — add details manually")
      } else {
        setForm(Object.assign({}, form, {
          address: result.address || form.address || "",
          type: result.type || form.type || "",
          webScore: result.webScore || form.webScore || "weak",
          issues: result.issues || [],
          talkingPoints: result.talkingPoints || [],
          currentWebsite: cleanUrl(result.currentWebsite),
        }))
      }
    } catch(e) { setErr("Lookup failed: " + e.message) }
    setLookingUp(false)
  }

  var doNearby = function() {
    setErr("")
    if (!navigator.geolocation) { setErr("Geolocation not supported"); return }
    setBusy("Getting location...")
    navigator.geolocation.getCurrentPosition(
      async function(pos) {
        var lat = pos.coords.latitude
        var lng = pos.coords.longitude
        try {
          setBusy("Identifying neighborhood...")
          var loc = await identifyLocation(lat, lng)
          setBusy("Scouting " + loc.neighborhood + "...")
          var biz = await scoutBiz(loc.neighborhood, loc.city)
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
            var pros = d.cities[targetCityId].neighborhoods[targetNhId].prospects
            var existing = Object.values(pros).map(function(p) { return p.name.toLowerCase().trim() })
            biz.forEach(function(b) {
              var bName = (b.name || "").toLowerCase().trim()
              if (!bName || existing.indexOf(bName) !== -1) return
              existing.push(bName)
              addedCount++
              var pid = uid()
              pros[pid] = {
                id: pid, name: b.name || "Unknown", address: b.address || "", type: b.type || "",
                webScore: b.webScore || "weak", issues: b.issues || [], talkingPoints: b.talkingPoints || [],
                currentWebsite: cleanUrl(b.currentWebsite), status: "not_visited", notes: "",
                contact: "", visitedAt: null,
              }
            })
          })
          setCId(targetCityId)
          setNId(targetNhId)
          setLastScoutCount(addedCount)
          setTimeout(function() { setLastScoutCount(null) }, 5000)
          setFilt("all")
          setExp(null)
          setWalkSel(new Set())
          setView("list")
        } catch(e) { setErr("Nearby scout failed: " + e.message) }
        setBusy("")
      },
      function() {
        setBusy("")
        setErr("Location access denied")
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
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

  var hdr = function(title, sub, back) {
    return (
      <div style={{ background: CL.card, borderBottom: "1px solid " + CL.border, padding: "12px 16px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {back && <button onClick={back} style={{ background: "none", border: "none", color: CL.mut, fontSize: 17, cursor: "pointer", padding: 0, fontFamily: FT }}>←</button>}
            <div>
              <h1 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: CL.wh, letterSpacing: "0.06em" }}>{title}</h1>
              {sub && <p style={{ margin: "1px 0 0", fontSize: 9, color: CL.mut }}>{sub}</p>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {ok && <span style={{ fontSize: 10, color: ok === "✓" ? "#5DE4A5" : "#E8606A", fontWeight: 600 }}>{ok}</span>}
            <button onClick={doLogout} style={{ background: "none", border: "none", color: CL.dim, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FT, lineHeight: 1 }} title="Lock">🔒</button>
          </div>
        </div>
      </div>
    )
  }

  // ===== HOME =====
  if (view === "home") {
    var cities = Object.values(data.cities).sort(function(a, b) { return a.name.localeCompare(b.name) })
    return (
      <div style={{ background: CL.bg, minHeight: "100vh", fontFamily: FT, color: CL.text, maxWidth: 500, margin: "0 auto" }}>
        {hdr("PROSPECT WALKER", "Hypandra Consulting")}
        <div style={{ padding: "16px 16px 100px" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
            <input value={input} onChange={function(e) { setInput(e.target.value) }} onKeyDown={function(e) { if (e.key === "Enter") doAddCity() }}
              placeholder="Enter a city..." style={{ flex: 1, background: CL.card, border: "1px solid " + CL.border, borderRadius: 8, color: CL.wh, fontSize: 13, padding: "10px 12px", fontFamily: FT, outline: "none", boxSizing: "border-box" }} />
            <button onClick={doAddCity} style={{ background: CL.acc, border: "none", borderRadius: 8, color: "#fff", fontSize: 11, padding: "10px 14px", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>+ City</button>
          </div>
          <button onClick={doNearby} style={{ display: "block", width: "100%", background: CL.card, border: "1px solid " + CL.border, borderRadius: 8, color: CL.text, fontSize: 11, padding: "10px 14px", cursor: "pointer", fontFamily: FT, fontWeight: 500, marginBottom: 20, textAlign: "center" }}>📍 Prospect Nearby</button>
          {ErrBox}
          {cities.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 20px", color: CL.dim }}>
              <p style={{ fontSize: 24, margin: "0 0 10px", opacity: 0.5 }}>📍</p>
              <p style={{ fontSize: 12, margin: 0 }}>Add a city to start prospecting</p>
              <p style={{ fontSize: 10, margin: "8px auto 0", lineHeight: 1.5, maxWidth: 280 }}>Auto-find neighborhoods, scout weak web presence, build walking routes</p>
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
                    return <button key={n.id} onClick={function() { setCId(c.id); setNId(n.id); setView("list"); setFilt("all"); setExp(null); setErr("") }} style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: CL.bg, border: "1px solid " + CL.border, borderLeft: "2px solid " + (s.total === 0 ? CL.dim : CL.acc), borderRadius: 6, padding: "9px 12px", marginBottom: 3, cursor: "pointer", fontFamily: FT, textAlign: "left" }}>
                      <span style={{ fontSize: 11, color: CL.wh, fontWeight: 500 }}>{n.name}</span>
                      <div style={{ display: "flex", gap: 3 }}>
                        {s.interested > 0 && <span style={{ fontSize: 8, color: STATUS.interested.color, background: STATUS.interested.bg, padding: "1px 5px", borderRadius: 3, fontWeight: 600, fontFamily: FT }}>★{s.interested}</span>}
                        {s.goBack > 0 && <span style={{ fontSize: 8, color: STATUS.go_back.color, background: STATUS.go_back.bg, padding: "1px 5px", borderRadius: 3, fontWeight: 600, fontFamily: FT }}>↻{s.goBack}</span>}
                        {s.visited > 0 && <span style={{ fontSize: 8, color: STATUS.visited.color, background: STATUS.visited.bg, padding: "1px 5px", borderRadius: 3, fontWeight: 600, fontFamily: FT }}>✓{s.visited}</span>}
                        {s.notVis > 0 && <span style={{ fontSize: 8, color: STATUS.not_visited.color, background: STATUS.not_visited.bg, padding: "1px 5px", borderRadius: 3, fontWeight: 600, fontFamily: FT }}>○{s.notVis}</span>}
                        {s.total === 0 && <span style={{ fontSize: 8, color: CL.dim }}>scout →</span>}
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
                      <button onClick={function() { if (confirm("Delete " + c.name + " and all its neighborhoods?")) { deepSet(function(d) { delete d.cities[c.id] }); setOpenCity(null) } }} style={{ background: "none", border: "1px solid #E8606A22", borderRadius: 6, color: "#E8606A88", fontSize: 10, padding: "7px 10px", cursor: "pointer", fontFamily: FT }}>🗑 Delete City</button>
                    </div>
                  )}
                </div>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ===== PICK NEIGHBORHOODS =====
  if (view === "pick") {
    return (
      <div style={{ background: CL.bg, minHeight: "100vh", fontFamily: FT, color: CL.text, maxWidth: 500, margin: "0 auto" }}>
        {hdr(pCity.toUpperCase(), nhPick.length + " neighborhoods found", function() { setView("home") })}
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
      var w = { poor: 0, weak: 1, decent: 2, strong: 3 }
      var d = (w[a.webScore] || 1) - (w[b.webScore] || 1)
      return d !== 0 ? d : (STATUS[a.status] || {}).sort - (STATUS[b.status] || {}).sort
    })
    var walkable = shown.filter(function(p) { return walkSel.has(p.id) })
    var mUrl = walkable.length >= 1 ? makeWalkUrl(walkable, userCoords) : null

    var toggleWalk = function(pid) {
      var s = new Set(walkSel)
      if (s.has(pid)) s.delete(pid); else s.add(pid)
      setWalkSel(s)
    }
    var selAllShown = function() {
      var s = new Set(walkSel)
      shown.forEach(function(p) { if (p.address) s.add(p.id) })
      setWalkSel(s)
    }
    var clearSel = function() { setWalkSel(new Set()) }

    return (
      <div style={{ background: CL.bg, minHeight: "100vh", fontFamily: FT, color: CL.text, maxWidth: 500, margin: "0 auto" }}>
        {hdr(nh.name, city ? city.name : "", function() { setNId(null); setView("home"); setErr(""); setWalkSel(new Set()) })}
        <div style={{ padding: "12px 16px 100px" }}>
          <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
            <button onClick={doScout} style={{ flex: 1, background: CL.warnBg, border: "1px solid " + CL.warn + "33", borderRadius: 7, color: CL.warn, fontSize: 10, padding: "8px 10px", cursor: "pointer", fontFamily: FT, fontWeight: 600 }}>🔍 Scout</button>
            {mUrl && <a href={mUrl} target="_blank" rel="noopener noreferrer" style={{ flex: 1, background: CL.accBg, border: "1px solid " + CL.acc + "33", borderRadius: 7, color: CL.acc, fontSize: 10, padding: "8px 10px", fontFamily: FT, fontWeight: 600, textDecoration: "none", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>🗺 Walk ({walkable.length})</a>}
          </div>
          {lastScoutCount !== null && <div style={{ background: CL.accBg, border: "1px solid " + CL.acc + "22", borderRadius: 5, padding: "5px 10px", marginBottom: 8 }}><p style={{ margin: 0, fontSize: 10, color: CL.acc }}>Found {lastScoutCount} new business{lastScoutCount !== 1 ? "es" : ""}</p></div>}
          <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
            <button onClick={selAllShown} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 5, color: CL.mut, fontSize: 9, padding: "4px 8px", cursor: "pointer", fontFamily: FT }}>☑ Select All</button>
            {walkSel.size > 0 && <button onClick={clearSel} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 5, color: CL.mut, fontSize: 9, padding: "4px 8px", cursor: "pointer", fontFamily: FT }}>Clear ({walkSel.size})</button>}
          </div>
          <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
            <button onClick={function() { setForm({ name: "", address: "", type: "", webScore: "weak", contact: "", notes: "", status: "not_visited" }); setEId(null); setView("form") }} style={{ background: CL.card, border: "1px solid " + CL.border, borderRadius: 7, color: CL.text, fontSize: 10, padding: "7px 10px", cursor: "pointer", fontFamily: FT }}>+ Manual</button>
            {walkSel.size > 0 && <button onClick={function() { if (confirm("Delete " + walkSel.size + " selected business" + (walkSel.size !== 1 ? "es" : "") + "?")) { deepSet(function(d) { walkSel.forEach(function(pid) { delete d.cities[cId].neighborhoods[nId].prospects[pid] }) }); setWalkSel(new Set()); setExp(null) } }} style={{ background: "#3B1418", border: "1px solid #E8606A33", borderRadius: 7, color: "#E8606A", fontSize: 10, padding: "7px 10px", cursor: "pointer", fontFamily: FT }}>🗑 Delete ({walkSel.size})</button>}
          </div>
          {ErrBox}
          <div style={{ display: "flex", gap: 3, marginBottom: 12, flexWrap: "wrap" }}>
            {["all", "not_visited", "go_back", "interested", "visited", "not_interested"].map(function(f) {
              var n = f === "all" ? all.length : all.filter(function(p) { return p.status === f }).length
              var s = STATUS[f]
              return <button key={f} onClick={function() { setFilt(f) }} style={{ background: filt === f ? (s ? s.bg : CL.card) : "transparent", border: "1px solid " + (filt === f ? (s ? s.color : CL.mut) + "33" : "transparent"), borderRadius: 4, color: s ? s.color : CL.mut, fontSize: 8, padding: "2px 6px", cursor: "pointer", fontFamily: FT, opacity: filt === f ? 1 : 0.5 }}>{f === "all" ? "ALL " + n : s.icon + n}</button>
            })}
          </div>
          {shown.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: CL.dim }}><p style={{ fontSize: 11 }}>{all.length === 0 ? "Hit Scout to find prospects" : "No matches"}</p></div>
          ) : shown.map(function(p) {
            var sc = STATUS[p.status]
            var ws = WS[p.webScore] || WS.weak
            var op = exp === p.id
            return (
              <div key={p.id} style={{ background: CL.card, borderLeft: "3px solid " + sc.color, border: "1px solid " + (op ? sc.color + "33" : CL.border), borderLeftWidth: 3, borderLeftColor: sc.color, borderRadius: 7, marginBottom: 5, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <button onClick={function(e) { e.stopPropagation(); toggleWalk(p.id) }} style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 4px 10px 10px", display: "flex", alignItems: "center", flexShrink: 0 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", background: walkSel.has(p.id) ? CL.acc : "transparent", border: "1.5px solid " + (walkSel.has(p.id) ? CL.acc : CL.bL), color: "#fff", fontSize: 10, fontWeight: 700 }}>{walkSel.has(p.id) ? "✓" : ""}</span>
                  </button>
                  <button onClick={function() { setExp(op ? null : p.id) }} style={{ display: "flex", flex: 1, justifyContent: "space-between", alignItems: "center", padding: "10px 12px 10px 4px", background: "none", border: "none", cursor: "pointer", fontFamily: FT, textAlign: "left", gap: 6 }}>
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
                  {p.issues && p.issues.length > 0 && <div style={{ marginTop: 8 }}><span style={{ fontSize: 7, color: "#E8606A", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Issues</span><div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>{p.issues.map(function(x, i) { return <span key={i} style={{ fontSize: 9, color: "#E8606A", background: "#3B141866", padding: "2px 6px", borderRadius: 3 }}>{x}</span> })}</div></div>}
                  {p.talkingPoints && p.talkingPoints.length > 0 && <div style={{ marginTop: 8, background: CL.bg, padding: "8px 10px", borderRadius: 5 }}><span style={{ fontSize: 7, color: CL.acc, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Talking Points</span>{p.talkingPoints.map(function(t, i) { return <p key={i} style={{ margin: "4px 0 0", fontSize: 10, color: CL.text, lineHeight: 1.4 }}>→ {t}</p> })}</div>}
                  {p.currentWebsite && <a href={p.currentWebsite} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 6, fontSize: 9, color: CL.acc }}>🔗 {p.currentWebsite}</a>}
                  {p.contact && <div style={{ marginTop: 8 }}><span style={{ fontSize: 7, color: "#60B8F7", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Contact</span><p style={{ margin: "3px 0 0", fontSize: 10, color: CL.text, lineHeight: 1.4 }}>👤 {p.contact}</p></div>}
                  {p.notes && <div style={{ marginTop: 8 }}><span style={{ fontSize: 7, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Notes</span><p style={{ margin: "3px 0 0", fontSize: 10, color: CL.text, lineHeight: 1.4 }}>{p.notes}</p></div>}
                  {p.visitedAt && <p style={{ margin: "6px 0 0", fontSize: 8, color: CL.dim }}>Visited {new Date(p.visitedAt).toLocaleDateString()}</p>}
                  <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {Object.keys(STATUS).map(function(k) { var v = STATUS[k]; return <button key={k} onClick={function() { doUpdateP(p.id, { status: k }) }} style={{ background: p.status === k ? v.bg : "transparent", border: "1px solid " + (p.status === k ? v.color + "44" : CL.border), borderRadius: 4, color: p.status === k ? v.color : CL.dim, fontSize: 9, padding: "3px 7px", cursor: "pointer", fontFamily: FT }}>{v.icon}</button> })}
                    <span style={{ flex: 1 }} />
                    <button onClick={function() { deepSet(function(d) { delete d.cities[cId].neighborhoods[nId].prospects[p.id] }); setExp(null) }} style={{ background: "none", border: "1px solid #E8606A33", borderRadius: 4, color: "#E8606A88", fontSize: 9, padding: "3px 8px", cursor: "pointer", fontFamily: FT }}>⚠ Fake</button>
                    <button onClick={function() { if (confirm("Delete " + p.name + "?")) { deepSet(function(d) { delete d.cities[cId].neighborhoods[nId].prospects[p.id] }); setExp(null) } }} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 4, color: CL.dim, fontSize: 9, padding: "3px 8px", cursor: "pointer", fontFamily: FT }}>🗑</button>
                    <button onClick={function() { setEId(p.id); setForm({ name: p.name, address: p.address || "", type: p.type || "", webScore: p.webScore || "weak", contact: p.contact || "", notes: p.notes || "", status: p.status }); setView("form") }} style={{ background: "none", border: "1px solid " + CL.border, borderRadius: 4, color: CL.mut, fontSize: 9, padding: "3px 8px", cursor: "pointer", fontFamily: FT }}>Edit</button>
                  </div>
                </div>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ===== ADD/EDIT FORM =====
  if (view === "form") {
    var isEd = !!eId
    return (
      <div style={{ background: CL.bg, minHeight: "100vh", fontFamily: FT, color: CL.text, maxWidth: 500, margin: "0 auto" }}>
        {hdr(isEd ? "EDIT" : "ADD PROSPECT", nh ? nh.name : "", function() { setView("list"); setEId(null) })}
        <div style={{ padding: "16px 16px 100px" }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Business Name</span>
            <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
              <input value={form.name || ""} onChange={function(e) { setForm(Object.assign({}, form, { name: e.target.value })) }} placeholder="e.g. Capitol Hill Coffee" style={{ flex: 1, background: CL.card, border: "1px solid " + CL.border, borderRadius: 6, color: CL.wh, fontSize: 12, padding: "9px 11px", fontFamily: FT, boxSizing: "border-box", outline: "none" }} />
              {!isEd && <button onClick={doLookup} disabled={lookingUp || !form.name || !form.name.trim()} style={{ background: lookingUp ? CL.card : CL.accBg, border: "1px solid " + CL.acc + "33", borderRadius: 6, color: lookingUp ? CL.dim : CL.acc, fontSize: 10, padding: "9px 12px", cursor: lookingUp || !form.name || !form.name.trim() ? "default" : "pointer", fontFamily: FT, fontWeight: 600, whiteSpace: "nowrap", opacity: !form.name || !form.name.trim() ? 0.4 : 1 }}>{lookingUp ? "..." : "Lookup"}</button>}
            </div>
          </div>
          {ErrBox}
          {[["address", "Address", "123 Pike St"], ["type", "Type", "coffee shop, salon..."]].map(function(a) {
            return <div key={a[0]} style={{ marginBottom: 12 }}><span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{a[1]}</span><input value={form[a[0]] || ""} onChange={function(e) { var u = {}; u[a[0]] = e.target.value; setForm(Object.assign({}, form, u)) }} placeholder={a[2]} style={{ display: "block", width: "100%", background: CL.card, border: "1px solid " + CL.border, borderRadius: 6, color: CL.wh, fontSize: 12, padding: "9px 11px", marginTop: 3, fontFamily: FT, boxSizing: "border-box", outline: "none" }} /></div>
          })}
          <div style={{ marginBottom: 12 }}><span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Web Presence</span><div style={{ display: "flex", gap: 5, marginTop: 4 }}>{Object.keys(WS).map(function(k) { var v = WS[k]; return <button key={k} onClick={function() { setForm(Object.assign({}, form, { webScore: k })) }} style={{ background: form.webScore === k ? v.bg : CL.card, border: "1px solid " + (form.webScore === k ? v.color + "55" : CL.border), borderRadius: 5, color: form.webScore === k ? v.color : CL.mut, fontSize: 10, padding: "5px 9px", cursor: "pointer", fontFamily: FT }}>{v.label}</button> })}</div></div>
          <div style={{ marginBottom: 12 }}><span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Contact Person</span><input value={form.contact || ""} onChange={function(e) { setForm(Object.assign({}, form, { contact: e.target.value })) }} placeholder="Name, role, phone..." style={{ display: "block", width: "100%", background: CL.card, border: "1px solid " + CL.border, borderRadius: 6, color: CL.wh, fontSize: 12, padding: "9px 11px", marginTop: 3, fontFamily: FT, boxSizing: "border-box", outline: "none" }} /></div>
          <div style={{ marginBottom: 12 }}><span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Notes</span><textarea value={form.notes || ""} onChange={function(e) { setForm(Object.assign({}, form, { notes: e.target.value })) }} placeholder="Who you talked to, follow-up..." rows={3} style={{ display: "block", width: "100%", background: CL.card, border: "1px solid " + CL.border, borderRadius: 6, color: CL.wh, fontSize: 11, padding: "9px 11px", marginTop: 3, fontFamily: FT, boxSizing: "border-box", resize: "vertical", outline: "none" }} /></div>
          <div style={{ marginBottom: 20 }}><span style={{ fontSize: 8, color: CL.dim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Status</span><div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>{Object.keys(STATUS).map(function(k) { var v = STATUS[k]; return <button key={k} onClick={function() { setForm(Object.assign({}, form, { status: k })) }} style={{ background: form.status === k ? v.bg : CL.card, border: "1px solid " + (form.status === k ? v.color + "55" : CL.border), borderRadius: 5, color: form.status === k ? v.color : CL.mut, fontSize: 9, padding: "5px 8px", cursor: "pointer", fontFamily: FT }}>{v.icon} {v.label}</button> })}</div></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={function() {
              if (!form.name || !form.name.trim()) return
              var f = { name: form.name.trim(), address: (form.address || "").trim(), type: (form.type || "").trim(), webScore: form.webScore || "weak", contact: (form.contact || "").trim(), notes: (form.notes || "").trim(), status: form.status || "not_visited", issues: form.issues || [], talkingPoints: form.talkingPoints || [], currentWebsite: cleanUrl(form.currentWebsite) }
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
