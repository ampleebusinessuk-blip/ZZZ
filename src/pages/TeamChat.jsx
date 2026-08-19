import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Hash, Send, Plus, Video, Smile, MessageSquare, ArrowLeft } from 'lucide-react'
import { useApp } from '../store.jsx'
import NameDialog from '../components/NameDialog.jsx'
import { messageTime, toRoomId, newRoomId } from '../dates.js'

const fallbackAvatar = (seed) => `https://i.pravatar.cc/150?u=${encodeURIComponent(seed || 'user')}`
const QUICK_EMOJI = ['😊', '👍', '🎉', '🙏', '🔥', '❤️', '😂', '✅']

export default function TeamChat() {
  const { state, sendMessage, openChannel, setChatFocus, loadChannelMessages, createChannel, toast } = useApp()
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mobileList, setMobileList] = useState(true)
  const navigate = useNavigate()
  const scrollRef = useRef(null)
  const me = state.user?.id

  const active = state.activeChannel

  // Only messages arriving while this screen is actually open should skip the
  // unread badge, so mark focus for as long as the page is mounted.
  useEffect(() => {
    setChatFocus(true)
    return () => setChatFocus(false)
  }, [setChatFocus])

  // Pick an initial channel, and honour the /team-chat?dm=<id> deep link.
  useEffect(() => {
    const dm = params.get('dm')
    if (dm) { openChannel(dm); setMobileList(false); setParams({}, { replace: true }); return }
    if (!active && state.channels[0]) openChannel(state.channels[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, state.channels, active])

  const nameOf = (c) => {
    if (!c) return ''
    if (c.type === 'dm') {
      const other = state.contacts.find((u) => u.id === c.members?.find((id) => id !== me))
      return other?.name || c.name || 'Direct message'
    }
    return c.name || 'channel'
  }
  const avatarOf = (c) => {
    const other = state.contacts.find((u) => u.id === c?.members?.find((id) => id !== me))
    return other?.avatar || c?.avatar || fallbackAvatar(c?.id)
  }

  const term = search.trim().toLowerCase()
  const channels = state.channels.filter((c) => nameOf(c).toLowerCase().includes(term))
  const channel = state.channels.find((c) => c.id === active)
  const messages = state.messages[active] || []
  const otherId = channel?.type === 'dm' ? channel.members?.find((id) => id !== me) : null
  const otherOnline = otherId ? state.online.includes(otherId) : false

  useEffect(() => {
    if (active) loadChannelMessages(active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, active])

  const send = () => {
    if (!text.trim() || !active) return
    sendMessage(active, text.trim())
    setText('')
    setEmojiOpen(false)
  }

  const selectChannel = (id) => { openChannel(id); setMobileList(false) }

  const makeChannel = async (name) => {
    try {
      const created = await createChannel(name)
      setCreating(false)
      openChannel(created.id)
      toast(`#${created.name} created`, 'check')
    } catch (e) { toast(e.message || 'Could not create the channel', 'info') }
  }

  // Group consecutive messages from the same author for a calmer transcript.
  const grouped = messages.map((m, i) => ({
    ...m,
    grouped: i > 0 && messages[i - 1].userId === m.userId && (m.ts || 0) - (messages[i - 1].ts || 0) < 5 * 60 * 1000,
  }))

  return (
    <div className="h-[calc(100dvh-140px)] lg:h-[calc(100vh-68px)] flex">
      <div className={`${mobileList ? 'flex' : 'hidden'} md:flex w-full md:w-[300px] shrink-0 border-r border-ink-200 bg-white dark:bg-[#12151C] flex-col`}>
        <div className="p-4 border-b border-ink-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-ink-900">Team Chat</h2>
            <div className="flex items-center gap-1">
              <button className="w-8 h-8 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-500" onClick={() => setCreating(true)} title="Create a channel">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations" className="w-full h-9 rounded-lg bg-ink-100 pl-9 pr-3 text-sm outline-none focus:bg-white dark:focus:bg-[#161A22]" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {channels.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-500">No conversations match.</p>}
          {channels.map((c) => {
            const dmId = c.type === 'dm' ? c.members?.find((id) => id !== me) : null
            return (
              <button key={c.id} onClick={() => selectChannel(c.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition ${active === c.id ? 'bg-blue-50' : 'hover:bg-ink-50'}`}>
                {c.type === 'channel' ? (
                  <div className="w-9 h-9 rounded-lg bg-ink-100 grid place-items-center text-ink-500 shrink-0"><Hash className="w-4 h-4" /></div>
                ) : (
                  <div className="relative shrink-0">
                    <img src={avatarOf(c)} alt="" className="w-9 h-9 rounded-lg object-cover" />
                    {dmId && state.online.includes(dmId) && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#12151C]" />}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm truncate ${c.unread ? 'font-bold text-ink-900' : 'font-semibold text-ink-800'}`}>{nameOf(c)}</p>
                    {c.ts && <span className="text-[11px] text-ink-400 shrink-0">{messageTime(c.ts)}</span>}
                  </div>
                  <p className="text-[12.5px] text-ink-500 truncate">{c.last || 'No messages yet'}</p>
                </div>
                {c.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-brand-blue text-white text-[10px] font-bold">{c.unread}</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className={`${mobileList ? 'hidden' : 'flex'} md:flex flex-1 flex-col bg-[#F5F7FB] dark:bg-[#0B0E14] min-w-0`}>
        <div className="h-16 shrink-0 bg-white dark:bg-[#12151C] border-b border-ink-200 px-3 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <button onClick={() => setMobileList(true)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-600 hover:bg-ink-100 md:hidden" aria-label="Back to conversations"><ArrowLeft className="h-5 w-5" /></button>
            {channel?.type === 'channel'
              ? <><Hash className="w-5 h-5 text-ink-400 shrink-0" /><span className="font-bold text-ink-900 truncate">{nameOf(channel)}</span></>
              : <>
                  <img src={avatarOf(channel)} className="w-8 h-8 rounded-full shrink-0" alt="" />
                  <div className="min-w-0">
                    <p className="font-bold text-ink-900 truncate leading-tight">{nameOf(channel)}</p>
                    <p className={`text-[11px] ${otherOnline ? 'text-emerald-600' : 'text-ink-400'}`}>{otherOnline ? 'Online' : 'Offline'}</p>
                  </div>
                </>}
          </div>
          <button
            title="Start a video call"
            className="w-9 h-9 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-600"
            onClick={() => navigate(`/meeting/${toRoomId(state.user?.pmi) || newRoomId()}`)}
          >
            <Video className="w-4.5 h-4.5" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-5 space-y-1.5">
          {!channel && <div className="h-full grid place-items-center text-ink-500 text-sm">Pick a conversation to start.</div>}
          {channel && messages.length === 0 && (
            <div className="h-full grid place-items-center text-center">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-blue-50 grid place-items-center mx-auto mb-3"><MessageSquare className="w-6 h-6 text-brand-blue" /></div>
                <p className="font-semibold text-ink-900">{channel.type === 'channel' ? `Welcome to #${nameOf(channel)}` : `Start a conversation with ${nameOf(channel)}`}</p>
                <p className="text-sm text-ink-500 mt-1">Send a message to get things started.</p>
              </div>
            </div>
          )}
          {grouped.map((m) => (
            <div key={m.id} className={`flex gap-3 ${m.me ? 'flex-row-reverse' : ''} ${m.grouped ? 'mt-0.5' : 'mt-4'}`}>
              {m.grouped
                ? <div className="w-9 shrink-0" />
                : <img src={m.avatar || fallbackAvatar(m.userId || m.author)} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />}
              <div className={`max-w-[86%] sm:max-w-[70%] ${m.me ? 'items-end text-right' : ''} flex flex-col`}>
                {!m.grouped && (
                  <div className={`flex items-center gap-2 mb-1 ${m.me ? 'flex-row-reverse' : ''}`}>
                    <span className="text-[13px] font-semibold text-ink-900">{m.me ? 'You' : m.author}</span>
                    <span className="text-[11px] text-ink-400">{messageTime(m.ts)}</span>
                  </div>
                )}
                <div className={`px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${m.me ? 'bg-brand-blue text-white rounded-tr-sm' : 'bg-white dark:bg-[#161A22] border border-ink-200 text-ink-800 rounded-tl-sm'}`}>{m.text}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-2 sm:p-4 bg-white dark:bg-[#12151C] border-t border-ink-200">
          <div className="relative flex items-end gap-2 rounded-2xl border border-ink-200 focus-within:border-brand-blue px-3 py-2">
            <textarea
              rows={1} value={text} disabled={!channel}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={channel ? `Message ${channel.type === 'channel' ? '#' + nameOf(channel) : nameOf(channel)}` : 'Pick a conversation'}
              className="flex-1 resize-none outline-none text-sm py-1.5 max-h-32 bg-transparent disabled:opacity-50"
            />
            <button className="text-ink-400 hover:text-ink-600 pb-1" onClick={() => setEmojiOpen((v) => !v)} title="Emoji"><Smile className="w-5 h-5" /></button>
            <button onClick={send} disabled={!text.trim() || !channel} className="w-9 h-9 grid place-items-center rounded-xl bg-brand-blue text-white disabled:opacity-40 hover:bg-brand-bluehover shrink-0"><Send className="w-4 h-4" /></button>
            {emojiOpen && (
              <div className="absolute bottom-14 right-12 bg-white dark:bg-[#1B2029] border border-ink-200 rounded-xl px-2 py-2 flex gap-1 shadow-soft animate-pop z-10">
                {QUICK_EMOJI.map((e) => (
                  <button key={e} onClick={() => { setText((t) => t + e); setEmojiOpen(false) }} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-ink-100 text-lg">{e}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {creating && (
        <NameDialog
          title="Create a channel" label="Channel name" initial="" confirmText="Create"
          onCancel={() => setCreating(false)} onConfirm={makeChannel}
        />
      )}
    </div>
  )
}
