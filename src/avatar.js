// Client-side mirror of server/src/avatar.js — same palette and hashing, so a
// given name always renders the same initials avatar whether the server
// assigned it at signup or this is just a transient fallback (e.g. a peer's
// metadata hasn't arrived yet). No third-party image service, no network call.
const PALETTE = ['#F87171', '#FB923C', '#FBBF24', '#A3E635', '#34D399', '#22D3EE', '#60A5FA', '#A78BFA', '#F472B6']

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return (words[0][0] + (words[1]?.[0] || '')).toUpperCase()
}

function colorFor(seed) {
  let hash = 0
  for (const ch of String(seed || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export function initialsAvatar(name) {
  const letters = initials(name)
  const color = colorFor(name)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="150" height="150" fill="${color}"/><text x="75" y="75" dy=".35em" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="58" fill="#ffffff" font-weight="600">${letters}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
