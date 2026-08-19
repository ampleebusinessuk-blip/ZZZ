import { api } from './api.js'

// There is exactly one supported external invite format. Keeping it here stops
// individual screens from accidentally copying the member-only /meeting URL.
export async function createGuestInviteLink(room) {
  const { url } = await api.createGuestLink(String(room))
  return new URL(url, window.location.origin).toString()
}

export async function copyGuestInvite(room, format = (url) => url) {
  const url = await createGuestInviteLink(room)
  await navigator.clipboard.writeText(format(url))
  return url
}
