// Real-workspace defaults. New accounts start EMPTY — no fake data.
// Contacts are the actual registered users (see /api/users). Chat has one shared
// "general" channel that everyone on the instance can post in; DMs are created
// on demand between real users.

export const generalChannel = {
  id: 'general',
  type: 'channel',
  name: 'general',
  unread: 0,
  last: 'Welcome! This is the start of #general.',
  time: '',
}

// Only the slices the client owns live here. Contacts, whiteboards, recordings
// and clips are server-managed resources with their own tables/endpoints.
export function defaultUserState() {
  return {
    docs: [],
    notes: [],
    notifications: [],
    settings: {
      hd: true, mirror: true, autoJoin: true,
      suppressNoise: true, joinSound: false, desktopNotif: true, notifSound: false,
      waitingRoom: true, theme: 'Light',
    },
  }
}
