import { useState, useRef, useCallback, useEffect } from 'react'
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
  const [status, setStatus]             = useState('idle')   // idle | connecting | connected | speaking | listening
  const [messages, setMessages]         = useState([{
    role: 'assistant',
    text: '안녕하세요. 경영학전공 면담봇입니다. 전공 선택이나 진로에 대해 궁금한 점을 편하게 물어봐주세요.'
  }])
  const [isProcessing, setIsProcessing] = useState(false)
  const [videoReady, setVideoReady]     = useState(false)
  const [isListening, setIsListening]   = useState(false)
  const [autoListen, setAutoListen]     = useState(false)

  const roomRef           = useRef(null)
  const sessionRef        = useRef(null)
  const videoRef          = useRef(null)
  const historyRef        = useRef([])

  // STT
  const recognitionRef    = useRef(null)
  const silenceTimerRef   = useRef(null)
  const isSpeakingRef     = useRef(false)
  const isProcessingRef   = useRef(false)
  const autoListenRef     = useRef(false)
  const isListeningRef    = useRef(false)

  useEffect(() => { isProcessingRef.current = isProcessing }, [isProcessing])
  useEffect(() => { autoListenRef.current   = autoListen }, [autoListen])
  useEffect(() => { isListeningRef.current  = isListening }, [isListening])
  useEffect(() => { isSpeakingRef.current   = (status === 'speaking') }, [status])

  // ─── HeyGen interrupt ────────────────────────────
  const interruptAvatar = useCallback(async () => {
    if (!isSpeakingRef.current || !sessionRef.current) return
    try {
      await callProxy('streaming.interrupt', {
        session_id: sessionRef.current.session_id
      })
    } catch (e) { console.error('interrupt error:', e) }
    isSpeakingRef.current = false
    setStatus('connected')
  }, [])

  // ─── 메시지 전송 ───────────────────────────────────
  const sendMessage = useCallback(async (userText) => {
    const text = userText.trim()
    if (!text || isProcessingRef.current) return
    setIsProcessing(true)

    setMessages(prev => [...prev, { role: 'user', text }])
    historyRef.current = [...historyRef.current, { role: 'user', content: text }]

    setMessages(prev => [...prev, { role: 'assistant', text: null }]) // typing

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: historyRef.current.slice(-8) })
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

      // HeyGen 발화
      if (sessionRef.current) {
        await callProxy('streaming.task', {
          session_id: sessionRef.current.session_id,
          text: ttsReply,
          task_type: 'repeat'
        })
      }
    } catch {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', text: '오류가 발생했어요. 다시 시도해 주세요.' }
        return next
      })
    } finally {
      setIsProcessing(false)
    }
  }, [])

  // ─── STT (Web Speech API) ────────────────────────
  const stopListening = useCallback(() => {
    clearTimeout(silenceTimerRef.current)
    setIsListening(false)
    isListeningRef.current = false
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
  }, [])

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListeningRef.current || isProcessingRef.current) return
    if (!sessionRef.current) return
    try { recognitionRef.current.start() } catch {}
  }, [])

  const initRecognition = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      alert('이 브라우저는 음성 인식을 지원하지 않아요. Chrome/Edge에서 사용해주세요.')
      return false
    }

    const rec = new SR()
    rec.lang            = 'ko-KR'
    rec.interimResults  = true
    rec.continuous      = true
    rec.maxAlternatives = 1

    rec.onstart = () => {
      isListeningRef.current = true
      setIsListening(true)
    }

    rec.onresult = async (event) => {
      clearTimeout(silenceTimerRef.current)
      let interim = '', final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) final += t
        else interim += t
      }

      // 아바타 발화 중 사용자가 말하면 interrupt
      if (isSpeakingRef.current && (final.trim() || (interim.trim() && interim.trim().length > 2))) {
        await interruptAvatar()
      }

      if (final.trim()) {
        stopListening()
        sendMessage(final.trim())
      } else if (interim) {
        silenceTimerRef.current = setTimeout(() => {
          const text = interim.trim()
          if (text && text.length > 1) {
            stopListening()
            sendMessage(text)
          }
        }, 2000)
      }
    }

    rec.onerror = (event) => {
      if (event.error === 'not-allowed') {
        alert('마이크 권한이 필요해요.\n브라우저 주소창 왼쪽의 자물쇠 아이콘을 클릭하여 마이크를 허용해주세요.')
        autoListenRef.current = false
        setAutoListen(false)
      } else if (event.error === 'no-speech') {
        if (autoListenRef.current && sessionRef.current && !isProcessingRef.current) {
          setTimeout(() => startListening(), 500)
        }
      }
      isListeningRef.current = false
      setIsListening(false)
    }

    rec.onend = () => {
      isListeningRef.current = false
      setIsListening(false)
      // 자동 listening 모드면 재시작
      if (autoListenRef.current && sessionRef.current && !isProcessingRef.current) {
        setTimeout(() => startListening(), 600)
      }
    }

    recognitionRef.current = rec
    return true
  }, [interruptAvatar, sendMessage, startListening, stopListening])

  // 답변 끝나면 (isProcessing false + autoListen 켜져있으면) 자동 마이크 재시작
  useEffect(() => {
    if (!isProcessing && autoListen && sessionRef.current && !isListeningRef.current) {
      const t = setTimeout(() => startListening(), 500)
      return () => clearTimeout(t)
    }
  }, [isProcessing, autoListen, startListening])

  // ─── 마이크 토글 (사용자 액션) ─────────────────────
  const toggleMic = useCallback(() => {
    if (!sessionRef.current) {
      alert('먼저 아바타를 시작해주세요.')
      return
    }
    if (!recognitionRef.current) {
      if (!initRecognition()) return
    }
    if (isListeningRef.current) {
      autoListenRef.current = false
      setAutoListen(false)
      stopListening()
    } else {
      autoListenRef.current = true
      setAutoListen(true)
      startListening()
    }
  }, [initRecognition, startListening, stopListening])

  // ─── 아바타 시작 ───────────────────────────────────
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
      await callProxy('streaming.start', { session_id: sessionRef.current.session_id })

      setStatus('connected')
    } catch (e) {
      console.error(e)
      setStatus('idle')
    }
  }, [])

  return (
    <div className={styles.app}>
      <AvatarPanel
        status={status}
        videoRef={videoRef}
        videoReady={videoReady}
        onStart={startAvatar}
        isListening={isListening}
      />
      <ChatPanel
        messages={messages}
        isProcessing={isProcessing}
        onSend={sendMessage}
        connected={status !== 'idle'}
        isListening={isListening}
        onToggleMic={toggleMic}
        micEnabled={status !== 'idle' && status !== 'connecting'}
      />
    </div>
  )
}
