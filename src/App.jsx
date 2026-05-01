import { useState, useRef, useCallback } from 'react'
import AvatarPanel from './components/AvatarPanel'
import ChatPanel from './components/ChatPanel'
import styles from './App.module.css'

const AVATAR_ID     = 'e2eb35c947644f09820aa3a4f9c15488'
const MIDDLETON_URL = 'https://middleton.p-e.kr/finbot'
const LIVEAVATAR_API = 'https://api.liveavatar.com/v1'

export default function App() {
  const [status, setStatus]         = useState('idle')   // idle | connecting | connected | speaking
  const [messages, setMessages]     = useState([{
    role: 'assistant',
    text: '안녕하세요! 경영학전공 면담봇입니다. 전공 선택이나 진로에 대해 궁금한 점을 편하게 물어보세요 😊'
  }])
  const [isProcessing, setIsProcessing] = useState(false)
  const [videoReady, setVideoReady]     = useState(false)

  const roomRef        = useRef(null)
  const sessionRef     = useRef(null)  // { session_id, session_token }
  const videoRef       = useRef(null)
  const historyRef     = useRef([])

  const startAvatar = useCallback(async () => {
    setStatus('connecting')
    try {
      // Middleton이 LIVEAVATAR_API_KEY로 세션 생성 + 시작까지 처리
      const res = await fetch(`${MIDDLETON_URL}/api/liveavatar-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_id: AVATAR_ID })
      })
      const data = await res.json()
      if (!data.livekit_url) throw new Error('LiveAvatar 세션 생성 실패: ' + JSON.stringify(data))

      sessionRef.current = {
        session_id:    data.session_id,
        session_token: data.session_token,
      }

      const room = new window.LivekitClient.Room()
      roomRef.current = room

      room.on(window.LivekitClient.RoomEvent.DataReceived, (payload) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload))
          if (msg.type === 'avatar_start_talking') setStatus('speaking')
          if (msg.type === 'avatar_stop_talking')  setStatus('connected')
        } catch {}
      })

      room.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === 'video' && videoRef.current) {
          track.attach(videoRef.current)
          setVideoReady(true)
        }
      })

      await room.connect(data.livekit_url, data.livekit_client_token)
      setStatus('connected')
    } catch (e) {
      console.error(e)
      setStatus('idle')
    }
  }, [])

  const speakText = useCallback(async (text) => {
    const session = sessionRef.current
    if (!session) return
    // session_token으로 직접 호출 (API Key 불필요)
    await fetch(`${LIVEAVATAR_API}/sessions/${session.session_id}/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.session_token}`,
      },
      body: JSON.stringify({ text, task_type: 'repeat' })
    })
  }, [])

  const sendMessage = useCallback(async (userText) => {
    if (!userText.trim() || isProcessing) return
    setIsProcessing(true)

    const userMsg = { role: 'user', text: userText }
    setMessages(prev => [...prev, userMsg])
    historyRef.current = [...historyRef.current, { role: 'user', content: userText }]

    setMessages(prev => [...prev, { role: 'assistant', text: null }]) // typing

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, history: historyRef.current.slice(-8) })
      })
      const data = await res.json()
      const reply    = data.reply    || '죄송해요, 답변을 생성하지 못했어요.'
      const ttsReply = data.ttsReply || reply

      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', text: reply }
        return next
      })
      historyRef.current = [...historyRef.current, { role: 'assistant', content: reply }]

      await speakText(ttsReply)
    } catch {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', text: '오류가 발생했어요. 다시 시도해 주세요.' }
        return next
      })
    } finally {
      setIsProcessing(false)
    }
  }, [isProcessing, speakText])

  return (
    <div className={styles.app}>
      <AvatarPanel
        status={status}
        videoRef={videoRef}
        videoReady={videoReady}
        onStart={startAvatar}
      />
      <ChatPanel
        messages={messages}
        isProcessing={isProcessing}
        onSend={sendMessage}
        connected={status !== 'idle'}
      />
    </div>
  )
}
