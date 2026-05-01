import { useState, useRef, useCallback } from 'react'
import AvatarPanel from './components/AvatarPanel'
import ChatPanel from './components/ChatPanel'
import styles from './App.module.css'

const AVATAR_ID = 'e2eb35c947644f09820aa3a4f9c15488'
const VOICE_ID  = '15d128072e194dc399d2898967941897'

async function callProxy(endpoint, payload) {
  const res = await fetch('/api/heygen-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, payload })
  })
  return res.json()
}

export default function App() {
  const [status, setStatus]         = useState('idle')   // idle | connecting | connected | speaking
  const [messages, setMessages]     = useState([{
    role: 'assistant',
    text: '안녕하세요. 경영학전공 면담봇입니다. 전공 선택이나 진로에 대해 궁금한 점을 편하게 물어봐주세요.'
  }])
  const [isProcessing, setIsProcessing] = useState(false)
  const [videoReady, setVideoReady]     = useState(false)

  const roomRef        = useRef(null)
  const sessionRef     = useRef(null)
  const videoRef       = useRef(null)
  const historyRef     = useRef([])

  const startAvatar = useCallback(async () => {
    setStatus('connecting')
    try {
      const tokenRes = await fetch('/api/heygen-token', { method: 'POST' }).then(r => r.json())
      if (!tokenRes.token) throw new Error('HeyGen 토큰 발급 실패: ' + JSON.stringify(tokenRes))

      const newRes = await callProxy('streaming.new', {
        avatar_id: AVATAR_ID,
        quality: 'medium',
        voice: { voice_id: VOICE_ID, rate: 1.0, emotion: 'friendly' },
        language: 'ko',
        version: 'v2',
        video_encoding: 'H264'
      })
      if (!newRes.data?.url) throw new Error('스트리밍 세션 생성 실패: ' + JSON.stringify(newRes))
      sessionRef.current = newRes.data

      const room = new window.LivekitClient.Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = room

      room.on(window.LivekitClient.RoomEvent.DataReceived, (payload) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload))
          if (msg.type === 'avatar_start_talking') setStatus('speaking')
          if (msg.type === 'avatar_stop_talking')  setStatus('connected')
        } catch {}
      })

      room.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track) => {
        if ((track.kind === 'video' || track.kind === 'audio') && videoRef.current) {
          track.attach(videoRef.current)
          if (track.kind === 'video') setVideoReady(true)
        }
      })

      await room.connect(sessionRef.current.url, sessionRef.current.access_token)
      await callProxy('streaming.start', {
        session_id: sessionRef.current.session_id
      })

      setStatus('connected')
    } catch (e) {
      console.error(e)
      setStatus('idle')
    }
  }, [])

  const speakText = useCallback(async (text) => {
    if (!sessionRef.current) return
    await callProxy('streaming.task', {
      session_id: sessionRef.current.session_id,
      text,
      task_type: 'repeat'
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
