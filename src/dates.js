// Real calendar helpers — always based on the actual current date.
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const pad = (n) => String(n).padStart(2, '0')
export const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`

export function todayKey() {
  const t = new Date()
  return toKey(t.getFullYear(), t.getMonth(), t.getDate())
}

// Returns weeks (arrays of 7 cells) covering the month, padded with prev/next-month days.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1)
  const startDow = first.getDay() // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysPrev = new Date(year, month, 0).getDate()

  const cells = []
  // leading days from previous month
  for (let i = startDow - 1; i >= 0; i--) {
    const d = daysPrev - i
    const dt = new Date(year, month - 1, d)
    cells.push({ day: d, out: true, key: toKey(dt.getFullYear(), dt.getMonth(), d) })
  }
  // current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, out: false, key: toKey(year, month, d) })
  }
  // trailing days to fill the last week
  let next = 1
  while (cells.length % 7 !== 0) {
    const dt = new Date(year, month + 1, next)
    cells.push({ day: next, out: true, key: toKey(dt.getFullYear(), dt.getMonth(), next) })
    next++
  }
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/* ---------------- Meeting + message time helpers ----------------
   Buckets and display strings are DERIVED, never stored. Storing them (as an
   earlier build did) freezes a meeting as "Today" forever. */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A fresh, unique 11-digit meeting ID formatted like "845 1234 5678".
export function newMeetingId() {
  const digits = Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('')
  return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`
}

export const toRoomId = (meetingId) => String(meetingId || '').replace(/\s/g, '')

// A fresh room for an instant meeting. Every "New Meeting" must get its own id —
// routing them all to a shared literal like "instant" puts unrelated people,
// across every account on the deployment, into the same call.
export const newRoomId = () => toRoomId(newMeetingId())

// Placeholder route segments that must never be used as a real room.
export const SHARED_ROOM_ALIASES = ['instant', 'personal', 'share', 'new']

// "14:30" -> "02:30 PM"
export function formatTime(t) {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return String(t)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`
}

const startOfDay = (d) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c }
const fromKey = (iso) => { const [y, mo, d] = String(iso).split('-').map(Number); return new Date(y, (mo || 1) - 1, d || 1) }

// Adds date/time/bucket to a stored meeting, computed against *now*.
export function decorateMeeting(meeting, now = new Date()) {
  const today = startOfDay(now)
  const dt = meeting.dateKey ? fromKey(meeting.dateKey) : today
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)

  let date
  if (dt.getTime() === today.getTime()) date = 'Today'
  else if (dt.getTime() === tomorrow.getTime()) date = `Tomorrow, ${MONTHS_SHORT[dt.getMonth()]} ${dt.getDate()}`
  else date = `${WEEKDAYS_SHORT[dt.getDay()]}, ${MONTHS_SHORT[dt.getMonth()]} ${dt.getDate()}`

  // A meeting is "previous" once its end time has passed, not at midnight —
  // otherwise this morning's standup still shows as upcoming all afternoon.
  const [h = 0, mi = 0] = String(meeting.startTime || '00:00').split(':').map(Number)
  const startsAt = new Date(dt); startsAt.setHours(h, mi, 0, 0)
  const endsAt = new Date(startsAt.getTime() + (Number(meeting.durationMins) || 60) * 60000)

  const bucket = endsAt < now ? 'previous' : dt.getTime() === today.getTime() ? 'today' : 'upcoming'
  const live = now >= startsAt && now < endsAt

  return { ...meeting, date, time: formatTime(meeting.startTime), bucket, live, startsAt: startsAt.getTime(), endsAt: endsAt.getTime() }
}

export const durationLabel = (mins) => {
  const m = Number(mins) || 60
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), rem = m % 60
  return rem ? `${h} hr ${rem} min` : `${h} hour${h > 1 ? 's' : ''}`
}

// Clock time for chat bubbles; falls back gracefully for pre-timestamp rows.
export function messageTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = startOfDay(d).getTime() === startOfDay(new Date()).getTime()
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay ? clock : `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${clock}`
}

// "Just now" / "5m ago" / "3h ago" / a date — for notifications, docs, boards.
export function relativeTime(ts) {
  if (!ts) return ''
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 45) return 'Just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024, i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

// Default schedule slot: the next clean half-hour, today.
export function nextSlot(now = new Date()) {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30)
  return { dateISO: toKey(d.getFullYear(), d.getMonth(), d.getDate()), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}
