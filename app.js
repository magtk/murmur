// murmur — pytania, wątpliwości, pomysły i krótkie quizy na zajęcia, bez backendu (PL/EN).
// Każdy głos ma znaczenie. / Every voice matters.
// Przeglądarka prowadzącego trzyma stan tablicy i jest jej „serwerem”; uczestnicy
// łączą się z nią bezpośrednio (WebRTC). Do zestawienia połączenia służą publiczne
// przekaźniki Nostr (biblioteka Trystero) — przez nie idzie tylko zaszyfrowana
// zapowiedź, treść tablicy płynie wprost między przeglądarkami.
import qrcode from './lib/qrcode.js'
import { STR } from './i18n.js'

// ---------- konfiguracja ----------
// Nazwa w nagłówku: domyślnie nazwa repo z adresu (magtk.github.io/<repo>/).
const BRAND_OVERRIDE = ''
const REPO = location.pathname.split('/').filter(Boolean).find(x => !x.includes('.')) || ''
const BRAND = BRAND_OVERRIDE || REPO || 'murmur'
// Oddziela Twoje pokoje od innych kopii aplikacji — wyliczane z adresu.
const APP_ID = 'board:' + location.host + '/' + REPO
// Opcjonalnie serwery TURN, gdyby sieć uczelni blokowała P2P, np.:
// [{ urls: 'turn:turn.example.org:3478', username: 'u', credential: 'p' }]
const TURN = []

const LOCAL = new URLSearchParams(location.search).has('local') // test w kartach jednej przeglądarki
const COLORS = ['amber', 'green', 'rose', 'teal', 'violet', 'sky']
const MAX_TEXT = 500
const MAX_CARDS = 1500
const APP_VERSION = '1.2.4'
const CONTACT_URL = 'mailto:magtk@duck.com?subject=' + encodeURIComponent('murmur – licencja komercyjna / commercial licence')
const REPO_URL = 'https://github.com/magtk/murmur'
// czas życia tablicy: liczony od ostatniej zmiany; po terminie pytamy, po kolejnych 7 dniach usuwamy
const TTL_OPTIONS = [7, 14, 21, 30]
const DAY = 864e5
const GRACE_DAYS = 7
const STUDENT_CACHE_DAYS = 30
const enc = s => new TextEncoder().encode(s)

// ---------- język ----------
const LANGS = Object.keys(STR)
let LANG = 'en'
const T = (k, ...a) => { const v = STR[LANG][k] ?? STR.pl[k] ?? k; return typeof v === 'function' ? v(...a) : v }
let rerender = () => {}
function initLang() {
  let l = ''
  try { l = new URLSearchParams(location.search).get('lang') || localStorage.getItem('tb.lang') || '' } catch {}
  l = (l || '').replace(/"/g, '')
  if (!LANGS.includes(l)) l = (navigator.languages || [navigator.language || 'en']).some(x => /^pl\b/i.test(x)) ? 'pl' : 'en'
  setLang(l, false)
}
function setLang(l, redraw = true) {
  LANG = l
  try { localStorage.setItem('tb.lang', JSON.stringify(l)) } catch {}
  document.documentElement.lang = l
  if (redraw) rerender()
}

// ---------- drobne narzędzia ----------
const $ = (s, r = document) => r.querySelector(s)
function h(tag, props, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'class') e.className = v
    else if (k === 'text') e.textContent = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (k in e && typeof v !== 'string') e[k] = v
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue
    e.append(c.nodeType ? c : document.createTextNode(String(c)))
  }
  return e
}
const ALPH = 'abcdefghijkmnpqrstuvwxyz23456789' // 32 znaki, bez 0/o/1/l
const uid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALPH[b % 32]).join('')
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0))
const clean = (s, n = 200) => String(s ?? '').replace(/\u0000/g, '').slice(0, n)
const cleanText = s => clean(s, MAX_TEXT).trim()
const pick = a => a[Math.floor(Math.random() * a.length)]
async function hid(s) {
  const d = await crypto.subtle.digest('SHA-256', enc('tablica:' + s))
  return b64u(d).slice(0, 12)
}
// odcisk klucza publicznego prowadzącego: 12 znaków = 60 bitów
async function fingerprint(pubB64) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', unb64u(pubB64)))
  return Array.from(d.slice(0, 12), b => ALPH[b % 32]).join('')
}
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
  del(k) { try { localStorage.removeItem(k) } catch {} },
}
let toastT
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show')
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms)
}
function slug(s) {
  return (s || BRAND).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'board'
}
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
const fmtLeft = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
function download(name, data, type = 'application/json') {
  const url = typeof data === 'string' && data.startsWith('data:') ? data : URL.createObjectURL(new Blob([data], { type }))
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove()
  if (!url.startsWith('data:')) setTimeout(() => URL.revokeObjectURL(url), 5000)
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(T('copied')) } catch { toast(T('copyManual')) }
}
function pickFile(accept = '.json,application/json') {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, onchange: () => res(i.files[0] || null) })
    i.click()
  })
}
const countdown = deadline => h('span', { class: 'cd', 'data-deadline': String(deadline), text: fmtLeft(deadline - Date.now()) })

// ---------- tożsamość tej przeglądarki ----------
const me = LS.get('tb.me', null) || { cid: uid(16), name: '' }
LS.set('tb.me', me)
if (LOCAL) { // w trybie testowym każda karta udaje osobną osobę
  try { me.cid = sessionStorage.getItem('tb.cid') || uid(16); sessionStorage.setItem('tb.cid', me.cid) } catch {}
}
const randomPseudo = () => `${pick(T('pseudoAdj'))} ${pick(T('pseudoNoun'))}`

// ---------- motyw, tryb rzutnika ----------
const THEMES = ['auto', 'light', 'dark']
let theme = THEMES.includes(LS.get('tb.theme', 'auto')) ? LS.get('tb.theme', 'auto') : 'auto'
function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}
applyTheme()
if (LS.get('tb.big', false)) document.body.classList.add('big')
function themeBtn(short = false) {
  const b = h('button', {
    title: T('themeTitle'),
    onclick: e => {
      e.stopPropagation()
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
      LS.set('tb.theme', theme); applyTheme(); upd()
    },
  })
  const upd = () => { b.textContent = T(short ? 'themeShort' : 'themeLbl')[theme] }
  upd(); return b
}
function toggleBig() { LS.set('tb.big', document.body.classList.toggle('big')) }
const langBtn = () => h('button', { class: 'lang', title: T('langTitle'), onclick: e => { e.stopPropagation(); setLang(LANGS[(LANGS.indexOf(LANG) + 1) % LANGS.length]) }, text: T('langBtn') })
// logo: inline SVG (kolory z CSS, więc podążają za motywem aplikacji); unikalne id masek
let LOGO_N = 0
function logoEl(cls) {
  const n = ++LOGO_N, Y = `lgY${n}`, O = `lgO${n}`
  const s = h('span', { class: 'logo ' + cls, 'aria-hidden': 'true' })
  s.innerHTML = `<svg viewBox="0 0 64 64" focusable="false"><defs>
<rect id="${O}" x="31.5" y="13.5" width="25" height="25" rx="3" transform="rotate(15 44 26)"/>
<g id="${Y}" transform="rotate(7 31 34)"><rect x="16.5" y="19.5" width="29" height="29" rx="3"/><path d="M21 47 L20 58 L30.5 47 Z"/></g>
<mask id="${O}m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><use href="#${Y}" fill="#000" stroke="#000" stroke-width="3" stroke-linejoin="round"/></mask>
<mask id="${Y}m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><use href="#${Y}" fill="#000" stroke="#000" stroke-width="3" stroke-linejoin="round"/><use href="#${O}" fill="#000" stroke="#000" stroke-width="3" stroke-linejoin="round"/></mask>
</defs><g class="lg-g" mask="url(#${Y}m)"><rect x="6.5" y="10" width="26" height="25" rx="3" transform="rotate(-16 19.5 22.5)"/></g>
<g class="lg-o" mask="url(#${O}m)"><use href="#${O}"/></g><use class="lg-y" href="#${Y}"/></svg>`
  return s
}
const brandEl = href => h(href ? 'a' : 'span', { class: 'brand', href: href || null, title: href ? T('home') : null }, logoEl('logo-sm'), '[ ', h('b', { text: BRAND }), ' ]')

// ---------- model ----------
function normQuiz(q = {}) {
  return {
    id: clean(q.id, 40) || uid(),
    title: clean(q.title || 'Quiz', 120),
    questions: (Array.isArray(q.questions) ? q.questions : []).map(qq => {
      const options = (Array.isArray(qq.options) ? qq.options : []).map(o => typeof o === 'string'
        ? { id: uid(), text: clean(o.replace(/^\*\s*/, ''), 200), ok: o.startsWith('*') }
        : { id: clean(o.id, 40) || uid(), text: clean(o.text, 200), ok: !!o.ok })
      return { id: clean(qq.id, 40) || uid(), text: clean(qq.text, 500), multi: qq.multi ?? options.filter(o => o.ok).length > 1, options }
    }),
    answers: q.answers && typeof q.answers === 'object' && !Array.isArray(q.answers) ? q.answers : {},
  }
}
function normBoard(b = {}, keepLive = false) {
  const sections = (Array.isArray(b.sections) ? b.sections : []).map((s, i) => {
    if (typeof s === 'string') s = { title: s }
    return { id: clean(s.id, 40) || uid(), title: clean(s.title, 120), color: COLORS.includes(s.color) ? s.color : COLORS[i % COLORS.length] }
  })
  let groups = (Array.isArray(b.groups) ? b.groups : []).map(g => ({ id: clean(g?.id, 40) || uid(), title: clean(g?.title, 80) }))
  const cards = (Array.isArray(b.cards) ? b.cards : []).map(c => ({
    id: clean(c.id, 40) || uid(),
    sec: typeof c.sec === 'number' ? sections[c.sec]?.id : clean(c.sec, 40),
    grp: groups.some(g => g.id === c.grp) ? c.grp : null,
    text: cleanText(c.text), name: clean(c.name, 40), by: clean(c.by, 40) || 'host',
    ts: Number(c.ts) || Date.now(), votes: Array.isArray(c.votes) ? c.votes.map(String) : [],
  })).filter(c => c.text && sections.some(s => s.id === c.sec))
  groups = groups.filter(g => cards.some(c => c.grp === g.id))
  const quizzes = (Array.isArray(b.quizzes) ? b.quizzes : []).map(normQuiz)
  const st = b.settings || {}
  let live = null
  if (keepLive && b.live && quizzes.some(q => q.id === b.live.id) && ['open', 'closed', 'shown'].includes(b.live.state)) {
    live = { id: b.live.id, state: b.live.state, until: Number(b.live.until) || null }
  }
  const hidden = !!st.hidden
  return {
    v: 2, title: clean(b.title || T('defBoard'), 120), sections, groups, cards, quizzes, live,
    revealAt: keepLive && hidden ? Number(b.revealAt) || null : null,
    settings: {
      showNames: st.showNames === true, // domyślnie anonimowo
      votes: st.votes !== false, locked: !!st.locked, hidden,
      drag: st.drag === 'all' ? 'all' : 'host',
      sort: ['new', 'old', 'votes'].includes(st.sort) ? st.sort : 'new',
      ttl: TTL_OPTIONS.includes(+st.ttl) ? +st.ttl : 21, // dni od ostatniej zmiany
    },
  }
}
function quizResults(q) {
  const out = {}
  for (const qq of q.questions) {
    const r = { _n: 0 }
    for (const o of qq.options) r[o.id] = 0
    for (const a of Object.values(q.answers)) {
      const sel = a?.[qq.id]
      if (!Array.isArray(sel) || !sel.length) continue
      r._n++
      for (const o of sel) if (o in r) r[o]++
    }
    out[qq.id] = r
  }
  return out
}
const newQuestion = () => ({ id: uid(), text: '', multi: false, options: [{ id: uid(), text: '', ok: true }, { id: uid(), text: '', ok: false }] })
// sortowanie elementów sekcji (kartki i grupy)
function sorter(mode) {
  const key = it => it.cards
    ? { v: it.cards.reduce((a, c) => a + c.votes, 0), n: Math.max(...it.cards.map(c => c.ts)), o: Math.min(...it.cards.map(c => c.ts)) }
    : { v: it.c.votes, n: it.c.ts, o: it.c.ts }
  if (mode === 'votes') return (a, b) => key(b).v - key(a).v || key(b).n - key(a).n
  if (mode === 'old') return (a, b) => key(a).o - key(b).o
  return (a, b) => key(b).n - key(a).n
}
const cardSorter = mode => mode === 'votes' ? (a, b) => b.votes - a.votes || b.ts - a.ts : mode === 'old' ? (a, b) => a.ts - b.ts : (a, b) => b.ts - a.ts

// ---------- sieć ----------
async function connect(room, pw) {
  const handlers = {}
  const net = { peers: new Set(), onJoin() {}, onLeave() {}, on(t, f) { handlers[t] = f }, send() {}, leave() {} }
  const fire = (t, d, p) => { try { handlers[t]?.(d, p) } catch (e) { console.error(e) } }
  if (LOCAL) {
    const id = uid(10), bc = new BroadcastChannel('tablica:' + room)
    const join = p => { if (!net.peers.has(p)) { net.peers.add(p); net.onJoin(p) } }
    bc.onmessage = ({ data: m }) => {
      if (!m || m.from === id || (m.to && m.to !== id)) return
      if (m.t === '_hi') { const known = net.peers.has(m.from); join(m.from); if (!m.to && !known) bc.postMessage({ t: '_hi', from: id, to: m.from }); return }
      if (m.t === '_bye') { if (net.peers.delete(m.from)) net.onLeave(m.from); return }
      join(m.from); fire(m.t, m.d, m.from)
    }
    net.send = (t, d, to) => bc.postMessage({ t, d, from: id, to })
    net.leave = () => { bc.postMessage({ t: '_bye', from: id }); bc.close() }
    addEventListener('pagehide', () => bc.postMessage({ t: '_bye', from: id }))
    setTimeout(() => bc.postMessage({ t: '_hi', from: id }), 0)
    return net
  }
  const { joinRoom } = await import('./lib/trystero.js')
  const cfg = { appId: APP_ID, password: pw, relayConfig: { warnOnRelayFailure: false } }
  if (TURN.length) cfg.turnConfig = TURN
  const r = joinRoom(cfg, room, { onJoinError: e => console.warn('[board] join error', e) })
  const actions = {}
  for (const t of ['chal', 'proof', 'hello', 'op', 'state']) {
    const a = r.makeAction(t)
    a.onMessage = (d, meta) => fire(t, d, meta?.peerId ?? meta)
    actions[t] = a
  }
  r.onPeerJoin = p => { net.peers.add(p); net.onJoin(p) }
  r.onPeerLeave = p => { net.peers.delete(p); net.onLeave(p) }
  net.send = (t, d, to) => {
    try { const x = actions[t].send(d, to ? { target: to } : undefined); x?.catch?.(e => console.warn(e)) } catch (e) { console.warn(e) }
  }
  net.leave = () => { try { r.leave() } catch {} }
  addEventListener('pagehide', () => net.leave())
  return net
}

// ---------- wspólne renderowanie tablicy ----------
const R = { secs: new Map(), addCol: null, role: '' }

function renderShell(role) {
  R.role = role; R.secs.clear(); R.addCol = null
  document.body.dataset.role = role
  $('#main').replaceChildren(h('div', { id: 'capture' },
    h('div', { id: 'warn' }),
    h('h1', { id: 'btitle' }),
    h('div', { id: 'reveal' }),
    h('section', { id: 'quiz', hidden: true }),
    h('div', { id: 'board' })))
}

function renderBoard(v, role) {
  const host = role === 'host'
  const t = $('#btitle')
  if (document.activeElement !== t) t.textContent = v.title
  document.title = `${v.title} · ${BRAND}`
  const wrap = $('#board')
  const ids = new Set(v.sections.map(s => s.id))
  for (const [id, o] of R.secs) if (!ids.has(id)) { o.root.remove(); R.secs.delete(id) }
  v.sections.forEach((s, i) => {
    let o = R.secs.get(s.id)
    if (!o) { o = makeSection(s.id, role); R.secs.set(s.id, o) }
    if (wrap.children[i] !== o.root) wrap.insertBefore(o.root, wrap.children[i] || null)
    o.root.dataset.color = s.color
    sectionHead(o, s, i, v, role)
    const secCards = v.cards.filter(c => c.sec === s.id)
    const groups = (v.groups || []).filter(g => secCards.some(c => c.grp === g.id))
    const items = [
      ...groups.map(g => ({ g, cards: secCards.filter(c => c.grp === g.id).sort(cardSorter(v.settings.sort)) })),
      ...secCards.filter(c => !c.grp || !groups.some(g => g.id === c.grp)).map(c => ({ c })),
    ].sort(sorter(v.settings.sort))
    o.list.replaceChildren(...items.map(it => it.g ? groupEl(it, v, role) : cardEl(it.c, v, role)))
    const more = v.hiddenCount?.[s.id] || 0
    o.hiddenNote.hidden = !more
    o.hiddenNote.textContent = more ? T('hiddenMore', more) : ''
    const locked = v.settings.locked && !host
    o.form.hidden = locked
    o.lockNote.hidden = !locked
  })
  if (host && H.editSections) {
    if (!R.addCol) R.addCol = h('button', { class: 'addcol noexport', onclick: addSection, text: T('addSection') })
    wrap.append(R.addCol)
  } else if (R.addCol) { R.addCol.remove() }
  if (!v.sections.length && !(host && H.editSections)) {
    if (!wrap.querySelector('.empty')) wrap.append(h('p', { class: 'empty', text: T(host ? 'noSecHost' : 'noSec') }))
  } else wrap.querySelector(':scope > .empty')?.remove()
}

function makeSection(id, role) {
  const o = {}
  o.head = h('div', { class: 'sec-head' })
  o.list = h('div', { class: 'list' })
  o.hiddenNote = h('p', { class: 'hidden-note', hidden: true })
  o.lockNote = h('p', { class: 'locked-note noexport', text: T('locked'), hidden: true })
  o.ta = h('textarea', {
    rows: 2, maxlength: MAX_TEXT, placeholder: T('placeholder'), 'aria-label': T('newCard'),
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit() } },
  })
  const submit = () => {
    const text = cleanText(o.ta.value)
    if (!text) return
    if (doOp({ k: 'add', sec: id, text }, role) !== false) o.ta.value = ''
    o.ta.focus()
  }
  o.form = h('div', { class: 'addf noexport' }, o.ta,
    h('div', { class: 'row' }, h('small', { text: T('enterHint') }), h('button', { class: 'pri', onclick: submit, text: T('drop') })))
  o.root = h('section', { class: 'sec', 'data-sec': id }, o.head, o.form, o.lockNote, o.list, o.hiddenNote)
  return o
}

function sectionHead(o, s, i, v, role) {
  if (o.head.contains(document.activeElement)) return
  const n = v.cards.filter(c => c.sec === s.id).length + (v.hiddenCount?.[s.id] || 0)
  if (role === 'host' && H.editSections) {
    const bs = () => H.board.sections.find(x => x.id === s.id)
    o.head.replaceChildren(
      h('button', { class: 'swatch noexport', title: T('changeColor'), onclick: () => { const x = bs(); x.color = COLORS[(COLORS.indexOf(x.color) + 1) % COLORS.length]; hostChanged() } }),
      h('input', { value: s.title, maxlength: 120, placeholder: T('secTitle'), 'aria-label': T('secTitle'), oninput: e => { bs().title = clean(e.target.value, 120); hostChanged() } }),
      h('button', { class: 'ic noexport', title: T('left'), disabled: i === 0, onclick: () => moveSection(s.id, -1), text: '◀' }),
      h('button', { class: 'ic noexport', title: T('right'), disabled: i === v.sections.length - 1, onclick: () => moveSection(s.id, 1), text: '▶' }),
      h('button', { class: 'ic noexport', title: T('delSec'), onclick: () => delSection(s.id), text: '🗑' }))
  } else {
    o.head.replaceChildren(h('h2', { text: s.title || T('untitled') }), h('span', { class: 'cnt', text: String(n) }))
  }
}

const SEEN = new Set() // animujemy tylko kartki, których jeszcze nie było na ekranie
const canArrange = (v, role) => !v.settings.hidden && (role === 'host' || v.settings.drag === 'all')

function cardEl(c, v, role) {
  const admin = role === 'host'
  if (v.masked && !c.mine) return h('article', { class: 'card masked', 'data-id': c.id }, h('p', { class: 'txt', text: '· · ·' }))
  const canEdit = admin || (c.mine && !v.settings.locked)
  const canDel = admin || c.mine
  const showVotes = !v.settings.hidden && (v.settings.votes || c.votes > 0)
  const fresh = SEEN.size > 0 && !SEEN.has(c.id); SEEN.add(c.id)
  return h('article', { class: 'card' + (c.mine && !admin ? ' mine' : '') + (fresh ? ' fresh' : ''), 'data-id': c.id },
    h('p', { class: 'txt', text: c.text }),
    h('footer', {},
      canArrange(v, role) && h('span', { class: 'grip noexport', title: T('dragHint'), onpointerdown: e => startDrag(e, c.id, role), text: '⠿' }),
      h('span', { class: 'who', text: c.name || (c.mine && !admin ? T('you') : '') }),
      h('span', { class: 'acts noexport' },
        canEdit && h('button', { class: 'ic', title: T('edit'), onclick: () => editCard(c, v, role), text: '✎' }),
        canDel && h('button', { class: 'ic', title: T('del'), onclick: () => { if (confirm(T('confirmDelCard'))) doOp({ k: 'del', id: c.id }, role) }, text: '×' })),
      showVotes && h('button', {
        class: 'vote' + (c.voted ? ' on' : ''), disabled: !v.settings.votes,
        title: T(c.voted ? 'unvote' : 'vote'), 'aria-pressed': String(!!c.voted),
        onclick: () => doOp({ k: 'vote', id: c.id }, role),
      }, '▲ ', String(c.votes))))
}

function groupEl({ g, cards }, v, role) {
  const can = canArrange(v, role)
  const votes = cards.reduce((a, c) => a + c.votes, 0)
  return h('div', { class: 'grp', 'data-grp': g.id },
    h('div', { class: 'grp-head' },
      h(can ? 'button' : 'span', { class: 'grp-title', title: can ? T('renameGroup') : null, onclick: can ? () => renameGroup(g, role) : null, text: g.title || T('group') }),
      h('span', { class: 'cnt', text: String(cards.length) }),
      votes > 0 && h('span', { class: 'grp-votes', text: '▲ ' + votes }),
      can && h('button', { class: 'ic noexport', title: T('ungroupAll'), onclick: () => doOp({ k: 'gdel', grp: g.id }, role), text: '×' })),
    cards.map(c => cardEl(c, v, role)))
}
function renameGroup(g, role) {
  const inp = h('input', { value: g.title, maxlength: 80, placeholder: T('groupName'), 'aria-label': T('groupName') })
  openDialog(T('renameGroup'), inp, [[T('cancel')], [T('save'), () => { doOp({ k: 'gtitle', grp: g.id, title: clean(inp.value, 80).trim() }, role) }, 'pri']])
  setTimeout(() => inp.select(), 30)
}

// ----- przeciąganie (mysz + dotyk, za uchwyt ⠿) -----
function startDrag(e, id, role) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  e.preventDefault()
  const src = e.target.closest('.card')
  const st = { x0: e.clientX, y0: e.clientY, ghost: null, target: null }
  const setTarget = t => {
    if (st.target === t) return
    st.target?.classList.remove('drop-on')
    st.target = t
    t?.classList.add('drop-on')
  }
  const move = ev => {
    if (!st.ghost) {
      if (Math.hypot(ev.clientX - st.x0, ev.clientY - st.y0) < 5) return
      const r = src.getBoundingClientRect()
      st.dx = st.x0 - r.left; st.dy = st.y0 - r.top
      st.ghost = src.cloneNode(true)
      st.ghost.classList.add('ghost'); st.ghost.style.width = r.width + 'px'
      st.ghost.style.setProperty('--c', getComputedStyle(src).getPropertyValue('--c'))
      document.body.append(st.ghost); document.body.classList.add('dragging')
      src.classList.add('drag-src')
    }
    st.ghost.style.transform = `translate(${ev.clientX - st.dx}px, ${ev.clientY - st.dy}px) rotate(1.5deg)`
    if (ev.clientY < 60) scrollBy(0, -14); else if (ev.clientY > innerHeight - 60) scrollBy(0, 14)
    const el = document.elementFromPoint(ev.clientX, ev.clientY)
    let t = el?.closest('.card:not(.masked):not(.ghost)') || el?.closest('.grp') || el?.closest('.sec')
    if (t?.dataset.id === id) t = null
    setTarget(t || null)
  }
  const end = ok => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel)
    document.body.classList.remove('dragging')
    document.querySelectorAll('.drag-src').forEach(x => x.classList.remove('drag-src'))
    st.ghost?.remove()
    const t = st.target; setTarget(null)
    if (!ok || !t || !st.ghost) return
    if (t.classList.contains('card')) doOp({ k: 'group', id, to: t.dataset.id }, role)
    else if (t.classList.contains('grp')) doOp({ k: 'group', id, grp: t.dataset.grp }, role)
    else if (t.classList.contains('sec')) doOp({ k: 'move', id, sec: t.dataset.sec }, role)
  }
  const up = () => end(true)
  const cancel = () => end(false)
  addEventListener('pointermove', move)
  addEventListener('pointerup', up)
  addEventListener('pointercancel', cancel)
}

function editCard(c, v, role) {
  const ta = h('textarea', { rows: 5, maxlength: MAX_TEXT, 'aria-label': T('editCard') }, c.text)
  const sel = role === 'host' && h('select', {}, v.sections.map(s => h('option', { value: s.id, selected: s.id === c.sec, text: s.title || T('untitled') })))
  // grupowanie bez przeciągania (WCAG 2.5.7): wybór grupy z listy
  const secName = id => v.sections.find(s => s.id === id)?.title || T('untitled')
  const gSel = role === 'host' && !v.settings.hidden && h('select', {},
    h('option', { value: '', selected: !c.grp, text: T('noGroup') }),
    (v.groups || []).map(g => {
      const any = v.cards.find(x => x.grp === g.id)
      return any && h('option', { value: g.id, selected: c.grp === g.id, text: `${g.title || T('group')} — ${secName(any.sec)}` })
    }),
    h('option', { value: 'new', text: T('newGroup') }))
  openDialog(T('editCard'), h('div', { class: 'stack' }, ta, sel && h('label', {}, T('section'), sel), gSel && h('label', {}, T('group'), gSel)),
    [[T('cancel')], [T('save'), () => {
      const text = cleanText(ta.value); if (!text) return false
      doOp({ k: 'edit', id: c.id, text, sec: sel ? sel.value : undefined }, role)
      if (gSel && gSel.value !== (c.grp || '')) doOp({ k: 'setgrp', id: c.id, grp: gSel.value }, role)
    }, 'pri']])
  setTimeout(() => ta.focus(), 30)
}

function doOp(o, role) {
  if (role === 'host') { if (applyOp(o, HOST_ACTOR)) hostChanged(); return true }
  return sendOp(o)
}

function openDialog(title, body, buttons = [[T('close')]]) {
  const d = $('#dlg')
  d.replaceChildren(h('form', { method: 'dialog' },
    h('h3', { text: title }), body,
    h('div', { class: 'dlg-btns' }, buttons.map(([label, fn, cls]) => h('button', {
      value: label, class: cls || '',
      onclick: e => { if (fn && fn(e) === false) e.preventDefault() },
    }, label)))))
  d.onclose = null
  d.showModal()
  return d
}

function resultsEl(questions, res, mine, showOk) {
  return questions.map((qq, i) => {
    const r = res?.[qq.id] || {}, tot = r._n || 0
    return h('div', { class: 'qres' },
      h('p', { class: 'qtext' }, `${i + 1}. ${qq.text}`, qq.multi && h('small', { text: T('multi') })),
      qq.options.map(o => {
        const n = r[o.id] || 0, pct = tot ? Math.round(100 * n / tot) : 0
        const ok = showOk && o.ok, my = mine?.[qq.id]?.includes(o.id)
        return h('div', { class: 'bar' + (ok ? ' ok' : '') + (my ? ' my' : '') },
          h('span', { class: 'fill', style: `width:${pct}%` }),
          h('span', { class: 'lbl' }, ok ? '✓ ' : '', o.text || '—', my ? T('youMark') : ''),
          h('span', { class: 'num', text: `${n} · ${pct}%` }))
      }))
  })
}

// ---------- eksport ----------
function markdown(m) {
  const L = [`# ${m.title}`, '', `_${new Date().toLocaleString(T('dateLocale'))}_`, '']
  const line = (c, ind = '') => `${ind}- ${c.text.replace(/\n/g, `  \n${ind}  `)}${c.name ? ` — *${c.name}*` : ''}${c.votes ? ` **(+${c.votes})**` : ''}`
  for (const s of m.sections) {
    L.push(`## ${s.title || T('untitled')}`, '')
    const cs = m.cards.filter(c => c.sec === s.id)
    if (!cs.length) L.push(T('mdNone'))
    const groups = (m.groups || []).filter(g => cs.some(c => c.grp === g.id))
    const items = [
      ...groups.map(g => ({ g, cards: cs.filter(c => c.grp === g.id).sort(cardSorter('votes')) })),
      ...cs.filter(c => !groups.some(g => g.id === c.grp)).map(c => ({ c })),
    ].sort(sorter('votes'))
    for (const it of items) {
      if (it.g) {
        const v = it.cards.reduce((a, c) => a + c.votes, 0)
        L.push(`- **${it.g.title || T('group')}**${v ? ` **(+${v})**` : ''}`)
        for (const c of it.cards) L.push(line(c, '  '))
      } else L.push(line(it.c))
    }
    L.push('')
  }
  for (const q of m.quizzes || []) {
    const res = q.results
    L.push(`## Quiz: ${q.title}`, '')
    q.questions.forEach((qq, i) => {
      const r = res?.[qq.id] || {}, tot = r._n || 0
      L.push(`### ${i + 1}. ${qq.text}${qq.multi ? T('mdMulti') : ''}`, '')
      for (const o of qq.options) {
        const n = r[o.id] || 0
        L.push(`- [${o.ok ? 'x' : ' '}] ${o.text}${res ? ` — ${n} (${tot ? Math.round(100 * n / tot) : 0}%)` : ''}`)
      }
      if (res) L.push('', T('mdAnswers', tot))
      L.push('')
    })
  }
  return L.join('\n')
}
async function exportPNG(title) {
  toast(T('pngWait'))
  const { toPng } = await import('./lib/html-to-image.js')
  document.body.classList.add('exporting')
  try {
    const url = await toPng($('#capture'), {
      pixelRatio: 2, backgroundColor: getComputedStyle(document.body).backgroundColor,
      filter: n => !(n.classList && n.classList.contains('noexport')),
    })
    download(`${slug(title)}-${stamp()}.png`, url)
  } catch (e) { console.error(e); toast(T('pngFail')) } finally { document.body.classList.remove('exporting') }
}
function menu(label, items, cls = '') {
  const d = h('details', { class: 'menu ' + cls })
  const pop = h('div', { class: 'menu-pop' }, items)
  d.append(h('summary', { class: 'btn', text: label }), pop)
  pop.addEventListener('click', e => { if (e.target.closest('button')) d.open = false })
  // na wąskim ekranie menu nie może wyjść poza lewą/prawą krawędź
  d.addEventListener('toggle', () => {
    if (!d.open) return
    pop.style.right = '0px'
    const r = pop.getBoundingClientRect()
    if (r.left < 8) pop.style.right = `${r.left - 8}px`
    else if (r.right > innerWidth - 8) pop.style.right = `${r.right - innerWidth + 8}px`
  })
  return d
}
document.addEventListener('click', e => {
  for (const d of document.querySelectorAll('details.menu[open]')) if (!d.contains(e.target)) d.open = false
})

// odliczanie: odświeża każdy [data-deadline]; u prowadzącego pilnuje terminów
setInterval(() => {
  for (const el of document.querySelectorAll('[data-deadline]')) el.textContent = fmtLeft(+el.dataset.deadline - Date.now())
  if (R.role === 'host' && H.board) hostTick()
}, 250)

// =====================================================================
// PROWADZĄCY
// =====================================================================
const H = { sess: null, board: null, net: null, priv: null, peers: new Map(), rate: new Map(), editSections: false, showQuiz: false, selQ: null, peek: false }
const HOST_ACTOR = { ch: 'host', name: '', admin: true }

async function newKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey))
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey)
  return { pub, priv, fp: await fingerprint(pub) }
}
async function startHostWith(board) {
  const cur = LS.get('tb.host')
  if (cur && !confirm(T('confirmReplace', cur.board?.title))) return
  const k = await newKeys()
  // krótki kod do przepisania: 4 znaki losowe + 6 znaków odcisku klucza (≈30 bitów ochrony przed podszyciem)
  LS.set('tb.host', { code: uid(4) + k.fp.slice(0, 6), short: true, ...k, created: Date.now(), touched: Date.now(), board: normBoard(board) })
  location.hash = 'host'
}

let saveT
function hostSave() {
  H.sess.touched = Date.now()
  clearTimeout(saveT); saveT = setTimeout(() => LS.set('tb.host', { ...H.sess, board: H.board }), 300)
}
// termin ważności sesji prowadzącego
const expiryOf = s => (s.touched || s.created || Date.now()) + (TTL_OPTIONS.includes(+s.board?.settings?.ttl) ? +s.board.settings.ttl : 21) * DAY
const daysLeft = s => Math.ceil((expiryOf(s) - Date.now()) / DAY)
let bcT
function scheduleBroadcast() {
  if (bcT) return
  bcT = setTimeout(() => { bcT = null; for (const [p, pi] of H.peers) H.net.send('state', viewFor(pi.ch), p) }, 120)
}
function hostChanged() { hostSave(); hostRender(); scheduleBroadcast() }
const contribCount = () => new Set(H.board.cards.filter(c => c.by !== 'host').map(c => c.by)).size

function viewFor(ch) {
  const b = H.board, s = b.settings, host = ch === 'host'
  const mask = s.hidden && !host
  const hiddenCount = {}
  let cards = b.cards
  if (mask) {
    for (const c of cards) if (c.by !== ch) hiddenCount[c.sec] = (hiddenCount[c.sec] || 0) + 1
    cards = cards.filter(c => c.by === ch)
  }
  const now = Date.now()
  const v = {
    title: b.title, sections: b.sections.map(x => ({ ...x })),
    groups: mask ? [] : b.groups.map(g => ({ ...g })),
    settings: { showNames: s.showNames, votes: s.votes, locked: s.locked, sort: s.sort, hidden: s.hidden, drag: s.drag },
    cards: cards.map(c => ({ id: c.id, sec: c.sec, grp: mask ? null : c.grp, text: c.text, name: s.showNames ? c.name : '', ts: c.ts, votes: c.votes.length, voted: c.votes.includes(ch), mine: c.by === ch })),
    hiddenCount, revealIn: s.hidden && b.revealAt ? Math.max(0, b.revealAt - now) : null,
    stats: { online: H.peers.size, contrib: contribCount() },
    quiz: null,
  }
  const L = b.live, q = L && b.quizzes.find(x => x.id === L.id)
  if (q) {
    const shown = L.state === 'shown'
    v.quiz = {
      id: q.id, title: q.title, state: L.state,
      untilIn: L.state === 'open' && L.until ? Math.max(0, L.until - now) : null,
      questions: q.questions.map(qq => ({ id: qq.id, text: qq.text, multi: qq.multi, options: qq.options.map(o => shown ? { id: o.id, text: o.text, ok: o.ok } : { id: o.id, text: o.text }) })),
      mine: q.answers[ch] || null, results: shown ? quizResults(q) : null,
    }
  }
  return v
}

function rateOk(p) {
  const now = Date.now(), a = (H.rate.get(p) || []).filter(t => now - t < 10000)
  if (a.length >= 30) return false
  a.push(now); H.rate.set(p, a); return true
}

function applyOp(d, actor) {
  const b = H.board
  if (!d || typeof d !== 'object') return false
  const sec = id => b.sections.some(s => s.id === id)
  const card = id => b.cards.find(c => c.id === id)
  const arrange = actor.admin || (b.settings.drag === 'all' && !b.settings.hidden)
  const prune = () => { b.groups = b.groups.filter(g => b.cards.some(c => c.grp === g.id)) }
  switch (d.k) {
    case 'add': {
      if (b.settings.locked && !actor.admin) return false
      if (!sec(d.sec) || b.cards.length >= MAX_CARDS) return false
      const text = cleanText(d.text); if (!text) return false
      b.cards.push({ id: uid(), sec: d.sec, grp: null, text, name: b.settings.showNames ? actor.name : '', by: actor.ch, ts: Date.now(), votes: [] })
      return true
    }
    case 'edit': {
      const c = b.cards.find(c => c.id === d.id && (actor.admin || c.by === actor.ch)); if (!c) return false
      if (b.settings.locked && !actor.admin) return false
      const text = cleanText(d.text); if (!text) return false
      c.text = text
      if (actor.admin && d.sec && sec(d.sec) && d.sec !== c.sec) { c.sec = d.sec; c.grp = null; prune() }
      return true
    }
    case 'del': {
      const i = b.cards.findIndex(c => c.id === d.id && (actor.admin || c.by === actor.ch)); if (i < 0) return false
      b.cards.splice(i, 1); prune(); return true
    }
    case 'vote': {
      if (!b.settings.votes || b.settings.hidden) return false
      const c = card(d.id); if (!c) return false
      const i = c.votes.indexOf(actor.ch)
      i < 0 ? c.votes.push(actor.ch) : c.votes.splice(i, 1)
      return true
    }
    case 'move': {
      if (!arrange) return false
      const c = card(d.id); if (!c || !sec(d.sec)) return false
      if (c.sec === d.sec && !c.grp) return false
      c.sec = d.sec; c.grp = null; prune(); return true
    }
    case 'group': {
      if (!arrange) return false
      const c = card(d.id); if (!c) return false
      if (d.to) {
        const t = card(d.to); if (!t || t === c) return false
        if (!t.grp) { const g = { id: uid(), title: '' }; b.groups.push(g); t.grp = g.id }
        if (c.grp === t.grp) return false
        c.grp = t.grp; c.sec = t.sec
      } else {
        const any = b.cards.find(x => x.grp === d.grp && x !== c); if (!any || c.grp === d.grp) return false
        c.grp = d.grp; c.sec = any.sec
      }
      prune(); return true
    }
    case 'setgrp': {
      if (!arrange) return false
      const c = card(d.id); if (!c) return false
      if (!d.grp) c.grp = null
      else if (d.grp === 'new') { const g = { id: uid(), title: '' }; b.groups.push(g); c.grp = g.id }
      else {
        const any = b.cards.find(x => x.grp === d.grp && x !== c); if (!any) return false
        c.grp = d.grp; c.sec = any.sec
      }
      prune(); return true
    }
    case 'gtitle': {
      if (!arrange) return false
      const g = b.groups.find(g => g.id === d.grp); if (!g) return false
      g.title = clean(d.title, 80); return true
    }
    case 'gdel': {
      if (!arrange) return false
      let n = 0
      for (const c of b.cards) if (c.grp === d.grp) { c.grp = null; n++ }
      prune(); return n > 0
    }
    case 'ans': {
      const L = b.live; if (!L || L.state !== 'open' || d.qz !== L.id) return false
      const q = b.quizzes.find(x => x.id === L.id); if (!q) return false
      const a = {}
      for (const qq of q.questions) {
        let sel = Array.isArray(d.a?.[qq.id]) ? d.a[qq.id].filter(o => qq.options.some(x => x.id === o)) : []
        sel = [...new Set(sel)]; if (!qq.multi) sel = sel.slice(0, 1)
        a[qq.id] = sel
      }
      q.answers[actor.ch] = a
      return true
    }
  }
  return false
}

function hostTick() {
  const b = H.board, now = Date.now()
  let changed = false
  if (b.settings.hidden && b.revealAt && now >= b.revealAt) { b.settings.hidden = false; b.revealAt = null; H.peek = false; changed = true; toast(T('revealed')) }
  if (b.live?.state === 'open' && b.live.until && now >= b.live.until) { b.live.state = 'shown'; b.live.until = null; changed = true }
  if (changed) { hostChanged(); hostTop() }
}

async function hostMain() {
  const s = LS.get('tb.host')
  if (!s.code || !s.fp) { // sesja ze starszej wersji → nowy, krótki link
    Object.assign(s, { code: uid(10) }, s.fp ? {} : await newKeys())
    delete s.room; delete s.pw
    LS.set('tb.host', s)
  }
  H.sess = s
  H.board = normBoard(s.board, true)
  H.showQuiz = !!H.board.live
  try {
    H.priv = await crypto.subtle.importKey('jwk', s.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  } catch (e) { return fatal('keyFail') }
  if (!s.touched) { s.touched = s.created = Date.now(); LS.set('tb.host', s) }
  rerender = () => { renderShell('host'); hostTop(); hostRender(); expiryNotice() }
  rerender()
  if (daysLeft(s) <= 0) setTimeout(expiredDialog, 300)

  const dup = new BroadcastChannel('tablica-host')
  dup.onmessage = ({ data }) => {
    if (data?.room !== s.code) return
    if (data.t === 'ping') dup.postMessage({ t: 'pong', room: s.code })
    if (data.t === 'pong') $('#warn').replaceChildren(h('p', { class: 'warn noexport', text: T('dupTab') }))
  }
  dup.postMessage({ t: 'ping', room: s.code })

  const net = H.net = await connect(s.code, s.code)
  net.onJoin = () => updateStatus()
  net.onLeave = p => {
    if (H.peers.delete(p)) scheduleBroadcast()
    H.rate.delete(p); updateStatus(); renderHostQuiz(); renderReveal(viewFor('host'), 'host')
  }
  net.on('chal', async (d, p) => {
    if (typeof d?.n !== 'string' || d.n.length > 64) return
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, H.priv, enc(d.n + '|' + s.code))
    net.send('proof', { n: d.n, s: b64u(sig), pk: s.pub }, p)
  })
  net.on('hello', async (d, p) => {
    if (typeof d?.cid !== 'string' || d.cid.length < 8 || d.cid.length > 64) return
    const ch = await hid(d.cid)
    const known = H.peers.has(p)
    H.peers.set(p, { ch, name: clean(d.name, 40).trim() })
    net.send('state', viewFor(ch), p)
    if (!known) scheduleBroadcast() // pozostali widzą nowy licznik
    updateStatus(); renderHostQuiz(); renderReveal(viewFor('host'), 'host')
  })
  net.on('op', (d, p) => {
    const pi = H.peers.get(p)
    if (!pi || !rateOk(p)) return
    if (applyOp(d, pi)) hostChanged()
  })
  addEventListener('beforeunload', e => { if (H.peers.size) { e.preventDefault(); e.returnValue = '' } })
}

const fmtCode = c => `${c.slice(0, 5)}-${c.slice(5)}`
const shareCode = () => H.sess.short ? fmtCode(H.sess.code) : `${H.sess.code}-${H.sess.fp}`
const baseUrl = () => `${location.origin}${location.pathname}${LOCAL ? '?local' : ''}`
function shareLink() { return `${baseUrl()}#${shareCode()}` }
const codeBox = () => H.sess.short && h('div', { class: 'codebox' },
  h('span', { class: 'lbl', text: T('codeLbl') }), h('span', { class: 'code', text: shareCode().toUpperCase() }),
  h('span', { class: 'addr', text: `${T('typeAddr')} ${baseUrl().replace(/^https?:\/\//, '').replace(/\?local$/, '')}` }))
function qrSvg(url, cls = 'qr') {
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make()
  const box = h('div', { class: cls }); box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true })
  return box
}
function openShare() {
  const url = shareLink()
  openDialog(T('shareTitle'), h('div', { class: 'share' }, qrSvg(url),
    codeBox(),
    h('div', { class: 'row' },
      h('input', { value: url, readonly: true, 'aria-label': 'Link', onclick: e => e.target.select() }),
      h('button', { type: 'button', class: 'pri', onclick: () => copy(url), text: T('copy') })),
    h('button', { type: 'button', onclick: () => { $('#dlg').close(); openQR() }, text: T('fullscreen') }),
    h('p', { class: 'hint', text: T('shareHint') }),
    h('a', { href: url, target: '_blank', rel: 'noopener', text: T('openStudent') })))
}
function openQR() {
  const url = shareLink()
  const close = () => { ov.remove(); removeEventListener('keydown', key) }
  const key = e => { if (e.key === 'Escape') close() }
  const ov = h('div', { class: 'qr-full', role: 'dialog', 'aria-label': T('qrTitle'), onclick: close },
    h('p', { class: 'qr-tag', text: T('tagline') }),
    qrSvg(url, 'qr-box'),
    !H.sess.short && h('p', { class: 'qr-url', text: url.replace(/^https?:\/\//, '') }),
    codeBox(),
    h('p', { class: 'qr-stats', id: 'qrStats' }),
    h('p', { class: 'hint', text: `${T('qrJoin')} · ${T('qrClose')}` }))
  ov.tabIndex = -1
  document.body.append(ov)
  ov.focus()
  addEventListener('keydown', key)
  updateStatus()
}

function hostTop() {
  const b = () => H.board
  const settingsPop = () => {
    const st = b().settings
    const chk = (checked, label, fn) => h('label', {}, h('input', { type: 'checkbox', checked, onchange: e => { fn(e.target.checked); hostChanged(); hostTop() } }), label)
    return [
      chk(st.showNames, T('pseudoNames'), x => { st.showNames = x }),
      chk(st.votes, T('votes'), x => { st.votes = x }),
      chk(st.drag === 'all', T('dragAll'), x => { st.drag = x ? 'all' : 'host' }),
      chk(st.locked, T('lockAdd'), x => { st.locked = x }),
      h('label', { title: T('ttlHint') }, T('ttlLbl'), h('select', { onchange: e => { st.ttl = +e.target.value; hostChanged(); expiryNotice() } },
        TTL_OPTIONS.map(d => h('option', { value: String(d), selected: st.ttl === d, text: T('ttlDays', d) })))),
      h('label', {}, T('sort'), h('select', { onchange: e => { st.sort = e.target.value; hostChanged() } },
        [['new', T('sortNew')], ['old', T('sortOld')], ['votes', T('sortVotes')]].map(([v, t]) => h('option', { value: v, selected: st.sort === v, text: t })))),
      h('hr'),
      h('button', { onclick: toggleBig, text: T('bigHost') }),
      themeBtn(),
    ]
  }
  $('#top').replaceChildren(...[
    brandEl('#'),
    h('span', { id: 'status', class: 'pill wait', text: T('connecting') }),
    b().settings.locked && h('span', { class: 'pill bad', text: T('lockedPill') }),
    h('span', { class: 'sp' }),
    h('button', { class: 'pri', onclick: openShare, text: T('share') }),
    h('button', { title: T('qrTitle'), onclick: openQR, text: T('qrBtn') }),
    !b().settings.hidden && h('button', { title: T('hideTitle'), onclick: () => { b().settings.hidden = true; b().revealAt = null; H.peek = false; hostChanged(); hostTop() }, text: T('hide') }),
    h('button', { class: H.showQuiz ? 'on' : '', onclick: () => { H.showQuiz = !H.showQuiz || !!b().live; hostTop(); renderHostQuiz() }, text: T('quiz') }),
    h('button', { class: H.editSections ? 'on' : '', title: T('layoutTitle'), onclick: () => { H.editSections = !H.editSections; H.secsReset(); hostTop(); hostRender() }, text: T(H.editSections ? 'layoutOn' : 'layout') }),
    menu(T('settings'), settingsPop()),
    menu(T('export'), [
      h('button', { onclick: () => download(`${slug(b().title)}-${stamp()}.json`, JSON.stringify({ ...b(), live: null, revealAt: null, exported: new Date().toISOString() }, null, 2)), text: T('expJson') }),
      h('button', { onclick: () => download(`${slug(b().title)}-${T('tplSuffix')}.json`, JSON.stringify(templateOf(b()), null, 2)), text: T('expTpl') }),
      h('button', { onclick: () => download(`${slug(b().title)}-${stamp()}.md`, markdown(hostMd()), 'text/markdown'), text: T('expMd') }),
      h('button', { onclick: () => exportPNG(b().title), text: T('expPng') }),
      h('button', { onclick: () => print(), text: T('print') }),
    ]),
    menu(T('more'), [
      h('button', { onclick: importIntoSession, text: T('importFile') }),
      h('button', { onclick: () => { if (confirm(T('confirmClear'))) { b().cards = []; b().groups = []; hostChanged() } }, text: T('clearCards') }),
      h('hr'),
      h('button', { onclick: () => { location.hash = '' }, text: T('home') }),
      h('button', { onclick: endSession, text: T('endSession') }),
    ]),
    langBtn()].filter(Boolean))
  updateStatus()
}
H.secsReset = () => { for (const o of R.secs.values()) o.head.replaceChildren() }

function updateStatus() {
  if (!H.board) return
  const on = H.peers.size, c = contribCount()
  const el = $('#status')
  if (el && H.net) {
    el.className = 'pill ok'
    el.textContent = `${LOCAL ? T('localMode') : ''}${T('people', on)} · ✎ ${c}`
    el.title = T('statsTitle')
  }
  const q = $('#qrStats'); if (q) q.textContent = `${T('people', on)} online · ✎ ${c}`
}

function exportJSON() {
  const b = H.board
  download(`${slug(b.title)}-${stamp()}.json`, JSON.stringify({ ...b, live: null, revealAt: null, exported: new Date().toISOString() }, null, 2))
}
function extendBoard(days = 7) {
  // przedłużenie = przesunięcie „ostatniej zmiany” tak, by do końca zostało `days` dni
  const ttl = H.board.settings.ttl
  H.sess.touched = Math.max(H.sess.touched || 0, Date.now() - (ttl - days) * DAY)
  LS.set('tb.host', { ...H.sess, board: H.board })
  expiryNotice(); toast(T('extended', daysLeft(H.sess)))
}
function expiryNotice() {
  const el = $('#warn'); if (!el || !H.sess) return
  el.querySelector('.expiry')?.remove()
  const n = daysLeft(H.sess)
  if (n > 3) return
  el.append(h('div', { class: 'warn expiry noexport' },
    h('span', { text: n > 0 ? T('expSoon', n) : T('expiredShort') }), ' ',
    h('button', { onclick: exportJSON, text: T('dlJson') }), ' ',
    h('button', { onclick: () => extendBoard(7), text: T('extend') })))
}
function expiredDialog() {
  const s = H.sess, when = new Date(s.touched || s.created).toLocaleDateString(T('dateLocale'))
  openDialog(T('expiredTitle'), h('div', { class: 'stack' },
    h('p', { style: 'margin:0', text: T('expiredBody', H.board.title, when) }),
    h('p', { class: 'hint', text: T('expiredAuto', GRACE_DAYS) })),
    [[T('dlJson'), () => { exportJSON(); return false }],
     [T('dlMd'), () => { download(`${slug(H.board.title)}-${stamp()}.md`, markdown(hostMd()), 'text/markdown'); return false }],
     [T('extend'), () => extendBoard(7)],
     [T('delNow'), () => { if (!confirm(T('confirmEnd'))) return false; H.net?.leave(); LS.del('tb.host'); H.peers.clear(); location.hash = '' }, 'pri']])
}

function hostRender() {
  const v = viewFor('host')
  v.masked = H.board.settings.hidden && !H.peek
  renderBoard(v, 'host')
  const t = $('#btitle')
  if (H.editSections) {
    if (!t.isContentEditable) {
      t.contentEditable = 'plaintext-only'
      if (t.contentEditable !== 'plaintext-only') t.contentEditable = 'true'
      t.oninput = () => { H.board.title = clean(t.textContent.replace(/\n/g, ' '), 120); hostSave(); scheduleBroadcast() }
      t.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); t.blur() } }
    }
  } else if (t.isContentEditable) { t.removeAttribute('contenteditable'); t.oninput = null }
  renderReveal(v, 'host')
  renderHostQuiz()
  updateStatus()
}

// pasek „kartki ukryte” (prowadzący i uczestnicy)
function renderReveal(v, role) {
  const el = $('#reveal'); if (!el) return
  if (!v.settings.hidden) { el.replaceChildren(); return }
  if (role === 'host') {
    const b = H.board
    const timer = b.revealAt
      ? [h('span', { class: 'when' }, T('revealIn'), ' ', countdown(b.revealAt)), h('button', { onclick: () => { b.revealAt = null; hostChanged() }, text: T('cancelTimer') })]
      : h('select', {
          'aria-label': T('timerPick'),
          onchange: e => { const m = +e.target.value; if (m) { b.revealAt = Date.now() + m * 60000; hostChanged() } },
        }, h('option', { value: '0', text: T('timerPick') }), [1, 2, 3, 5, 10].map(m => h('option', { value: String(m), text: `${m} min` })))
    el.replaceChildren(h('div', { class: 'reveal noexport' },
      h('span', { class: 'msg', text: T('revealHost', v.stats.contrib, v.stats.online) }),
      timer,
      h('button', { onclick: () => { H.peek = !H.peek; hostRender() }, text: T(H.peek ? 'peekOff' : 'peek') }),
      h('button', { class: 'pri', onclick: () => { b.settings.hidden = false; b.revealAt = null; H.peek = false; hostChanged(); hostTop() }, text: T('revealNow') })))
  } else {
    el.replaceChildren(h('div', { class: 'reveal' },
      h('span', { class: 'msg' }, T('revealStu'), ' ', v.stats?.contrib ? h('b', { text: T('contribTitle', v.stats.contrib) + '.' }) : ''),
      v.revealAt && h('span', { class: 'when' }, T('revealIn'), ' ', countdown(v.revealAt))))
  }
}

function addSection() {
  const b = H.board
  b.sections.push({ id: uid(), title: T('newSection'), color: COLORS[b.sections.length % COLORS.length] })
  hostChanged()
  R.secs.get(b.sections.at(-1).id)?.head.querySelector('input')?.select()
}
function moveSection(id, dir) {
  const a = H.board.sections, i = a.findIndex(s => s.id === id), j = i + dir
  if (j < 0 || j >= a.length) return
  ;[a[i], a[j]] = [a[j], a[i]]; H.secsReset(); hostChanged()
}
function delSection(id) {
  const n = H.board.cards.filter(c => c.sec === id).length
  if (n && !confirm(T('confirmDelSec', n))) return
  H.board.sections = H.board.sections.filter(s => s.id !== id)
  H.board.cards = H.board.cards.filter(c => c.sec !== id)
  H.board.groups = H.board.groups.filter(g => H.board.cards.some(c => c.grp === g.id))
  hostChanged()
}
function templateOf(b) {
  return {
    title: b.title, sections: b.sections.map(({ title, color }) => ({ title, color })),
    settings: b.settings,
    quizzes: b.quizzes.map(q => ({ title: q.title, questions: q.questions.map(qq => ({ text: qq.text, multi: qq.multi, options: qq.options.map(o => ({ text: o.text, ok: o.ok })) })) })),
  }
}
function hostMd() {
  const v = viewFor('host'), b = H.board
  return { ...v, quizzes: b.quizzes.filter(q => q.questions.length).map(q => ({ ...q, results: Object.keys(q.answers).length ? quizResults(q) : null })) }
}
async function importIntoSession() {
  const f = await pickFile(); if (!f) return
  try {
    const nb = normBoard(JSON.parse(await f.text()))
    if (!confirm(T('confirmImport', nb.title))) return
    H.board = nb; H.selQ = null; H.secsReset(); hostChanged(); hostTop(); toast(T('loaded'))
  } catch (e) { toast(T('badFile')) }
}
function endSession() {
  if (!confirm(T('confirmEnd'))) return
  H.net?.leave(); LS.del('tb.host'); H.peers.clear(); location.hash = ''
}

// ----- quiz (prowadzący) -----
function renderHostQuiz() {
  const el = $('#quiz'); if (!el || !H.board) return
  const b = H.board, L = b.live
  el.hidden = !(H.showQuiz || L)
  if (el.hidden) return
  if (L) H.selQ = L.id
  if (!H.selQ || !b.quizzes.some(q => q.id === H.selQ)) H.selQ = b.quizzes[0]?.id || null
  const q = b.quizzes.find(x => x.id === H.selQ)
  const live = !!(L && q && L.id === q.id)
  const st = L?.state
  const set = (state, secs = 0) => { b.live = state ? { id: q.id, state, until: state === 'open' && secs ? Date.now() + secs * 1000 : null } : null; hostChanged() }
  const dur = h('select', { 'aria-label': T('qTimeLeft') },
    [[0, T('noLimit')], [30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min']].map(([v, t]) => h('option', { value: String(v), text: t })))
  const head = h('div', { class: 'qhead noexport' },
    h('strong', { text: T('quiz') }),
    b.quizzes.length > 0 && h('select', { disabled: !!L, 'aria-label': T('pickQuiz'), onchange: e => { H.selQ = e.target.value; renderHostQuiz() } },
      b.quizzes.map(x => h('option', { value: x.id, selected: x.id === H.selQ, text: x.title || T('untitled') }))),
    h('button', { disabled: !!L, onclick: newQuiz, text: T('newQ') }),
    q && h('button', { disabled: live, onclick: () => editQuiz(q), text: T('edit') }),
    q && h('button', { disabled: live, onclick: () => { if (confirm(T('confirmDelQuiz', q.title))) { b.quizzes = b.quizzes.filter(x => x !== q); H.selQ = null; hostChanged() } }, text: T('del') }),
    h('span', { class: 'sp' }),
    q && !L && q.questions.length > 0 && dur,
    q && !L && h('button', { class: 'pri', disabled: !q.questions.length, onclick: () => set('open', +dur.value), text: T('start') }),
    live && st === 'open' && L.until && h('span', { class: 'qcd' }, '⏱ ', countdown(L.until)),
    live && st === 'open' && h('button', { class: 'pri', onclick: () => set('closed'), text: T('closeAns') }),
    live && st === 'closed' && h('button', { onclick: () => set('open'), text: T('reopen') }),
    live && st !== 'shown' && h('button', { class: st === 'closed' ? 'pri' : '', onclick: () => set('shown'), text: T('showRes') }),
    live && st === 'shown' && h('button', { onclick: () => set('closed'), text: T('hideRes') }),
    live && h('button', { onclick: () => set(null), text: T('endQuiz') }),
    q && h('button', { disabled: !Object.keys(q.answers).length, onclick: () => { if (confirm(T('confirmClearAns'))) { q.answers = {}; hostChanged() } }, text: T('clearAns') }),
    !L && h('button', { class: 'ic', title: T('collapse'), onclick: () => { H.showQuiz = false; hostTop(); renderHostQuiz() }, text: '×' }))
  if (!q) {
    el.replaceChildren(head, h('p', { class: 'qmeta', text: T('noQuiz') }))
    return
  }
  const n = Object.keys(q.answers).length
  el.replaceChildren(head,
    h('p', { class: 'qtitle', text: q.title }),
    h('p', { class: 'qmeta noexport', text: live ? T('qLive', T('qState')[st], n, H.peers.size) : T('qIdle', q.questions.length, n) }),
    q.questions.length ? h('div', { class: 'qwrap' }, resultsEl(q.questions, quizResults(q), null, true)) : h('p', { class: 'qmeta', text: T('qEmpty') }))
}
function newQuiz() {
  const q = { id: uid(), title: T('quizN', H.board.quizzes.length + 1), questions: [newQuestion()], answers: {} }
  H.board.quizzes.push(q); H.selQ = q.id; H.showQuiz = true
  hostChanged(); editQuiz(q)
}
function editQuiz(q) {
  const body = h('div', { class: 'qed' })
  const draw = () => body.replaceChildren(
    h('label', {}, T('title'), h('input', { value: q.title, maxlength: 120, oninput: e => { q.title = clean(e.target.value, 120); hostSave() } })),
    q.questions.map((qq, i) => h('fieldset', {},
      h('legend', { text: T('questionN', i + 1) }),
      h('textarea', { rows: 2, maxlength: 500, placeholder: T('qText'), oninput: e => { qq.text = clean(e.target.value, 500); hostSave() } }, qq.text),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: qq.multi, onchange: e => { qq.multi = e.target.checked; if (!qq.multi) { let seen = false; for (const o of qq.options) { if (o.ok && seen) o.ok = false; if (o.ok) seen = true } } draw() } }), T('multiChk')),
      qq.options.map((o, j) => h('div', { class: 'opt' },
        h('input', { type: qq.multi ? 'checkbox' : 'radio', name: 'ok-' + qq.id, checked: o.ok, title: T('correct'), 'aria-label': T('correctShort'), onchange: e => { if (!qq.multi) qq.options.forEach(x => { x.ok = false }); o.ok = e.target.checked; hostSave() } }),
        h('input', { type: 'text', value: o.text, maxlength: 200, placeholder: T('answerN', j + 1), oninput: e => { o.text = clean(e.target.value, 200); hostSave() } }),
        h('button', { type: 'button', class: 'ic', title: T('delAnswer'), disabled: qq.options.length <= 2, onclick: () => { qq.options.splice(j, 1); draw() }, text: '×' }))),
      h('div', { class: 'row' },
        h('button', { type: 'button', disabled: qq.options.length >= 8, onclick: () => { qq.options.push({ id: uid(), text: '', ok: false }); draw() }, text: T('addAnswer') }),
        h('button', { type: 'button', onclick: () => { q.questions.splice(i, 1); draw() }, text: T('delQuestion') })))),
    h('button', { type: 'button', onclick: () => { q.questions.push(newQuestion()); draw() }, text: T('addQuestion') }),
    h('p', { class: 'hint', text: T('quizHint') }))
  draw()
  const d = openDialog(T('quizEdit'), body, [[T('done'), null, 'pri']])
  d.onclose = () => hostChanged()
}

// =====================================================================
// UCZESTNIK
// =====================================================================
const S = { room: '', net: null, host: null, v: null, qsig: '', draft: null, status: 'wait', pseud: null }

async function studentMain(code, fp) {
  S.room = code
  rerender = () => {
    renderShell('student'); studentTop(); S.qsig = ''
    if (S.v) applyState(S.v, true); else $('#btitle').textContent = T('connectingBoard')
  }
  renderShell('student')
  studentTop()
  const cached = LS.get('tb.last.' + code)
  if (cached) applyState({ ...cached, revealIn: null, quiz: cached.quiz && { ...cached.quiz, untilIn: null } }, true)
  else $('#btitle').textContent = T('connectingBoard')
  setStatus('wait')
  const net = S.net = await connect(code, code)
  const pending = new Map()
  const challenge = peer => { const n = uid(16); pending.set(peer, n); net.send('chal', { n }, peer) }
  net.onJoin = peer => { if (!S.host) challenge(peer) }
  net.onLeave = peer => {
    pending.delete(peer)
    if (peer === S.host) { S.host = null; setStatus('lost'); for (const q of net.peers) challenge(q) }
  }
  net.on('proof', async (d, peer) => {
    if (S.host || typeof d?.s !== 'string' || typeof d?.pk !== 'string' || d.pk.length > 200 || pending.get(peer) !== d.n) return
    pending.delete(peer)
    let ok = false
    try {
      if ((await fingerprint(d.pk)).startsWith(fp)) { // klucz zgodny z odciskiem z linku (12 lub 6 znaków)
        const pub = await crypto.subtle.importKey('raw', unb64u(d.pk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
        ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(d.s), enc(d.n + '|' + code))
      }
    } catch {}
    if (!ok || S.host) return
    S.host = peer; setStatus('ok'); sendHello()
  })
  net.on('state', (d, peer) => { if (peer === S.host && d && typeof d === 'object') applyState(d) })
  setTimeout(() => { if (!S.host) setStatus('slow') }, 20000)
}
function sendHello() { if (S.host) S.net.send('hello', { cid: me.cid, name: me.name }, S.host) }
function sendOp(o) {
  if (!S.host) { toast(T('noConn')); return false }
  S.net.send('op', o, S.host); return true
}
function setStatus(k, quiet = false) {
  S.status = k
  const el = $('#status'); if (!el) return
  const cls = { wait: 'wait', ok: 'ok', lost: 'bad', slow: 'wait' }[k]
  const [txt, tip] = T('st')[k]
  el.className = 'pill ' + cls; el.textContent = txt; el.title = tip
  if (!quiet && (k === 'slow' || k === 'lost')) toast(tip, 6000)
}
function studentTop() {
  const pseud = !!S.v?.settings.showNames
  S.pseud = pseud
  if (pseud && !me.name) { me.name = randomPseudo(); LS.set('tb.me', me); sendHello() }
  const setName = n => { me.name = clean(n, 40).trim(); LS.set('tb.me', me); sendHello() }
  const nameIn = pseud && h('input', {
    class: 'name-in', value: me.name, maxlength: 40, placeholder: T('namePh'), 'aria-label': T('nameAria'),
    onchange: e => { setName(e.target.value); toast(me.name ? T('nameSet', me.name) : T('noName')) },
  })
  const dice = pseud && h('button', { class: 'ic dice', title: T('pseudoTitle'), onclick: () => { setName(randomPseudo()); nameIn.value = me.name; toast(T('nameSet', me.name)) }, text: '🎲' })
  const c = S.v?.stats?.contrib || 0
  $('#top').replaceChildren(...[
    brandEl(),
    h('span', { id: 'status', class: 'pill wait', text: T('connecting') }),
    h('span', { id: 'contrib', class: 'pill contrib', title: T('contribTitle', c), hidden: !c, text: `✎ ${c}` }),
    h('span', { class: 'sp' }),
    pseud ? nameIn : h('span', { class: 'pill anon', title: T('anonTitle'), text: T('anonPill') }),
    dice,
    langBtn(),
    menu('⋯', [
      h('button', { onclick: () => S.v && exportPNG(S.v.title), text: T('stuPng') }),
      h('button', { onclick: () => S.v && download(`${slug(S.v.title)}-${stamp()}.md`, markdown({ ...S.v, quizzes: S.v.quiz?.results ? [S.v.quiz] : [] }), 'text/markdown'), text: T('expMd') }),
      h('hr'),
      h('button', { onclick: toggleBig, text: T('bigStu') }),
      themeBtn(),
    ])].filter(Boolean))
  setStatus(S.status, true)
}
function applyState(v, cached = false) {
  if (!Array.isArray(v.sections) || !Array.isArray(v.cards)) return
  const now = Date.now()
  v.revealAt = v.revealIn != null ? now + v.revealIn : null
  if (v.quiz) v.quiz.untilAt = v.quiz.untilIn != null ? now + v.quiz.untilIn : null
  S.v = v
  if (!cached) LS.set('tb.last.' + S.room, { ...v, _ts: Date.now() })
  if (S.pseud !== !!v.settings.showNames) studentTop()
  const cp = $('#contrib'), c = v.stats?.contrib || 0
  if (cp) { cp.hidden = !c; cp.textContent = `✎ ${c}`; cp.title = T('contribTitle', c) }
  renderBoard(v, 'student')
  renderReveal(v, 'student')
  renderStudentQuiz(v)
}
function renderStudentQuiz(v) {
  const el = $('#quiz'), q = v.quiz
  if (!q) { el.hidden = true; el.replaceChildren(); S.qsig = ''; return }
  const sig = JSON.stringify([q.id, q.state, q.questions, q.results, q.mine, !!q.untilAt])
  if (sig === S.qsig) { const cd = el.querySelector('.qcd .cd'); if (cd && q.untilAt) cd.dataset.deadline = String(q.untilAt); return }
  S.qsig = sig; el.hidden = false
  if (!S.draft || S.draft.id !== q.id) S.draft = { id: q.id, a: JSON.parse(JSON.stringify(q.mine || {})) }
  if (q.mine && q.state !== 'open') S.draft.a = JSON.parse(JSON.stringify(q.mine))
  const kids = [h('div', { class: 'qtop' }, h('p', { class: 'qtitle', text: q.title }), q.state === 'open' && q.untilAt && h('span', { class: 'qcd' }, '⏱ ', countdown(q.untilAt)))]
  if (q.state === 'open') {
    const status = h('small')
    const same = () => JSON.stringify(normA(S.draft.a, q)) === JSON.stringify(normA(q.mine || {}, q))
    const upd = () => { status.textContent = q.mine ? T(same() ? 'sent' : 'unsent') : T('notSent') }
    kids.push(h('div', { class: 'qwrap qform' }, q.questions.map((qq, i) => h('div', {},
      h('p', { class: 'qtext' }, `${i + 1}. ${qq.text}`, qq.multi && h('small', { text: T('selectAll') })),
      qq.options.map(o => h('label', { class: 'opt' },
        h('input', {
          type: qq.multi ? 'checkbox' : 'radio', name: 'q-' + qq.id, value: o.id,
          checked: (S.draft.a[qq.id] || []).includes(o.id),
          onchange: e => {
            const cur = new Set(qq.multi ? S.draft.a[qq.id] || [] : [])
            e.target.checked ? cur.add(o.id) : cur.delete(o.id)
            S.draft.a[qq.id] = [...cur]; upd()
          },
        }), h('span', { text: o.text })))))))
    kids.push(h('div', { class: 'qsend' }, h('button', { class: 'pri', onclick: () => { if (sendOp({ k: 'ans', qz: q.id, a: S.draft.a })) toast(T('sentToast')) }, text: T(q.mine ? 'resend' : 'send') }), status))
    upd()
  } else if (q.state === 'closed') {
    kids.push(h('p', { class: 'qmeta', text: T(q.mine ? 'savedWait' : 'closedAns') }))
  } else {
    kids.push(h('div', { class: 'qwrap' }, resultsEl(q.questions, q.results, q.mine, true)))
  }
  el.replaceChildren(...kids)
}
const normA = (a, q) => q.questions.map(qq => [...(a[qq.id] || [])].sort())

// =====================================================================
// EKRAN STARTOWY
// =====================================================================
async function homeMain() {
  document.body.dataset.role = 'home'
  R.role = 'home'
  rerender = homeMain
  document.title = BRAND
  $('#top').replaceChildren(brandEl(), h('span', { class: 'sp' }), langBtn(), themeBtn(true))
  const params = new URLSearchParams(location.search)
  const t = params.get('t')
  if (t) {
    params.delete('t')
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''))
    if (/^boards\/[\w.-]+\.json$/.test(t)) { await loadTemplate(t); if (location.hash === '#host') return }
  }
  const cur = LS.get('tb.host')
  const title = h('input', { value: T('defTitle'), maxlength: 120, 'aria-label': T('boardTitleAria') })
  const secs = h('textarea', { rows: 4, 'aria-label': T('secsAria') }, T('defSecs'))
  const tplBox = h('div', { class: 'tpl' }, h('p', { class: 'hint', text: T('loadingList') }))
  const lead = T('lead')
  $('#main').replaceChildren(h('div', { class: 'home' },
    h('p', { class: 'kicker' }, h('span', { text: T('kicker') }), h('a', { href: 'https://magtk.github.io/', title: 'MagTk lab', text: '[ magtk ]' })),
    h('h1', {}, logoEl('logo-h1'), BRAND),
    h('p', { class: 'lead' }, h('em', { text: lead[0] }), lead[1], h('strong', { text: lead[2] }), '.', h('br'), lead[3], h('br'), h('span', { class: 'amber', text: lead[4] })),
    h('div', { class: 'panels' },
      h('div', { class: 'panel join' },
        h('h2', { text: T('joinTitle') }),
        h('form', { class: 'stack', onsubmit: e => {
          e.preventDefault()
          const v = e.target.code.value.toLowerCase().replace(/[\s-]/g, '')
          if (!/^[a-km-np-z2-9]{10}$/.test(v)) { toast(T('joinBad'), 5000); e.target.code.focus(); return }
          location.hash = fmtCode(v)
        } },
          h('label', { class: 'stack' }, T('joinHint'),
            h('input', { name: 'code', class: 'code-in', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 14, placeholder: T('joinPh') })),
          h('button', { class: 'pri', type: 'submit', text: T('joinBtn') }))),
      cur && h('div', { class: 'panel cont' },
        h('h2', { text: T('openBoard') }),
        h('p', { class: 'cont-title', text: cur.board?.title || T('defBoard') }),
        h('p', { class: 'cont-meta', text: T('contMeta', cur.board?.sections?.length || 0, cur.board?.cards?.length || 0, cur.board?.quizzes?.length || 0) }),
        h('p', { class: 'cont-meta' + (daysLeft(cur) <= 3 ? ' exp' : ''), text: daysLeft(cur) > 0 ? T('homeExp', daysLeft(cur)) : T('expiredShort') }),
        h('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' },
          h('button', { class: 'pri', onclick: () => { location.hash = 'host' }, text: T('back') }))),
    ),
    // nowa tablica: jeden szeroki panel z akordeonem (szablony / pusta tablica)
    h('section', { class: 'panel newb' },
      h('h2', { text: T('newBoard') }),
      h('details', { class: 'acc', open: true },
        h('summary', { text: T('fromTpl') }),
        tplBox,
        h('button', { class: 'loadfile', onclick: async () => { const f = await pickFile(); if (!f) return; try { startHostWith(normBoard(JSON.parse(await f.text()))) } catch { toast(T('badFile')) } }, text: T('loadDisk') })),
      h('details', { class: 'acc' },
        h('summary', { text: T('accBlank') }),
        h('div', { class: 'blank' },
          h('label', { class: 'stack' }, T('title'), title),
          h('label', { class: 'stack' }, T('secsLbl'), secs),
          h('button', { class: 'pri', onclick: () => startHostWith({ title: title.value, sections: secs.value.split('\n').map(s => s.trim()).filter(Boolean) }), text: T('create') })))),
    h('p', { class: 'home-foot' }, h('a', { href: `${REPO_URL}/blob/main/CHANGELOG.md`, target: '_blank', rel: 'noopener', text: `v${APP_VERSION}` }), ' · © 2026 magtk · ',
      h('a', { href: 'https://polyformproject.org/licenses/noncommercial/1.0.0/', target: '_blank', rel: 'noopener', text: 'PolyForm Noncommercial 1.0.0' }),
      ' · ', T('licenceFree'), ' · ', T('licenceCommercial'), ' ',
      h('a', { href: CONTACT_URL, target: '_blank', rel: 'noopener', text: T('licenceAsk') }),
      ' · ', h('a', { href: '#', onclick: e => { e.preventDefault(); privacyDialog() }, text: T('privacy') }))))
  try {
    const r = await fetch('boards/index.json', { cache: 'no-cache' })
    if (!r.ok) throw 0
    const list = (await r.json()).filter(x => x && x.file && (!x.lang || x.lang === LANG))
    if (!list.length) throw 0
    tplBox.replaceChildren(...list.map(x => h('button', { onclick: () => loadTemplate('boards/' + x.file) }, x.title, x.desc && h('small', { text: x.desc }))))
  } catch { tplBox.replaceChildren(h('p', { class: 'hint', text: T('noTpl') })) }
}
function privacyDialog() {
  openDialog(T('privacy'), h('div', { class: 'stack privacy' },
    T('privacyBody').map(([b, t]) => h('p', {}, h('b', { text: b }), ' ', t))))
}
async function loadTemplate(path) {
  try {
    const r = await fetch(path, { cache: 'no-cache' }); if (!r.ok) throw 0
    await startHostWith(normBoard(await r.json()))
  } catch { toast(T('tplFail', path)) }
}

function fatal(key) {
  rerender = () => fatal(key)
  $('#top').replaceChildren(brandEl(), h('span', { class: 'sp' }), langBtn(), themeBtn(true))
  $('#main').replaceChildren(h('div', { class: 'home' }, h('h1', { text: T('oops') }), h('p', { class: 'lead', text: T(key) }), h('a', { href: location.pathname, text: T('backHome') })))
}

// ---------- start ----------
// sprzątanie: wygasłe tablice prowadzącego (po okresie łaski) i stare kopie u uczestników
function housekeeping() {
  const s = LS.get('tb.host')
  if (s && s.board && Date.now() > expiryOf(s) + GRACE_DAYS * DAY) LS.del('tb.host')
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith('tb.last.')) continue
      const v = LS.get(k, null)
      if (!v || !v._ts || Date.now() - v._ts > STUDENT_CACHE_DAYS * DAY) localStorage.removeItem(k)
    }
  } catch {}
}
function route() {
  if (!window.isSecureContext || !crypto.subtle) return fatal('needHttps')
  housekeeping()
  const hash = location.hash.toLowerCase()
  const m = hash.match(/^#([a-z2-9]{10})-([a-z2-9]{12})$/)
  if (m) return studentMain(m[1], m[2])
  const k = hash.match(/^#([a-km-np-z2-9]{5})-?([a-km-np-z2-9]{5})$/) // krótki kod
  if (k) { const code = k[1] + k[2]; return studentMain(code, code.slice(4)) }
  if (/^#r=/.test(location.hash)) return fatal('badLink') // link ze starszej wersji
  if (location.hash === '#host' && LS.get('tb.host')) return hostMain()
  return homeMain()
}
addEventListener('hashchange', () => location.reload())
initLang()
route()
