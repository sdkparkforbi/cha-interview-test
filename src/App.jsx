import { useState, useRef, useCallback, useEffect } from 'react'
import AvatarPanel from './components/AvatarPanel'
import ChatPanel from './components/ChatPanel'
import AuthModal from './components/AuthModal'
import styles from './App.module.css'
import { getUser, clearAuth, verifyToken, newSessionId, saveChat } from './lib/api'

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
  const [messages, setMessages]         = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [videoReady, setVideoReady]     = useState(false)
  const [isListening, setIsListening]   = useState(false)
  const [autoListen, setAutoListen]     = useState(false)
  const [user, setUser]                 = useState(getUser())     // 로그인된 사용자 (없으면 null = 익명)
  // 첫 접속 시 자동으로 로그인 모달 — 저장된 토큰(=user)이 있으면 안 띄움
  const [authOpen, setAuthOpen]         = useState(() => !getUser())

  const roomRef           = useRef(null)
  const sessionRef        = useRef(null)
  const videoRef          = useRef(null)
  const historyRef        = useRef([])
  const sessionIdRef      = useRef(null)   // 학교 DB용 세션 ID (아바타 시작 시 새로)

  // 토큰 검증 — 성공하면 모달 닫음 / 실패하면 모달 유지 (이미 열려있음)
  useEffect(() => {
    verifyToken().then(u => {
      if (u) {
        setUser(u)
        setAuthOpen(false)
      }
    })
  }, [])

  const handleLogout = () => {
    clearAuth()
    setUser(null)
  }

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

    // DB 저장 (사용자 메시지)
    if (sessionIdRef.current) saveChat(sessionIdRef.current, 'user', text)

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

      // DB 저장 (어시스턴트 답변)
      if (sessionIdRef.current) saveChat(sessionIdRef.current, 'assistant', reply)

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

      // (echo 기반 자동 interrupt 제거 — ESC 키로 명시적 처리. 헤드폰 미사용 시 안정성 ↑)

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
    if (!isProcessing && autoListen && sessionRef.current && !isListeningRef.current && !isSpeakingRef.current) {
      const t = setTimeout(() => startListening(), 500)
      return () => clearTimeout(t)
    }
  }, [isProcessing, autoListen, startListening])

  // ─── 봇 발화 중 마이크 stop (echo로 봇 음성이 새 질문이 되는 무한루프 방지) ───
  // status === 'speaking' 들어오면 STT off, 'connected'로 빠지면 다시 on (autoListen 켜져있을 때만)
  useEffect(() => {
    if (status === 'speaking') {
      // 발화 시작 → 마이크 즉시 끔 (autoListen 플래그는 유지)
      if (recognitionRef.current && isListeningRef.current) {
        try { recognitionRef.current.stop() } catch {}
      }
    } else if (status === 'connected' && autoListenRef.current && !isListeningRef.current && !isProcessingRef.current) {
      // 발화 종료 → 잠시 후 마이크 다시 on (트랙 잔향 회피 위해 800ms 지연)
      const t = setTimeout(() => startListening(), 800)
      return () => clearTimeout(t)
    }
  }, [status, startListening])

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

  // ─── ESC 키로 발화 인터럽트 (OAC 규성 SOFT-INTERRUPT 패턴 차용) ───
  // - status === 'speaking' 일 때만 동작
  // - window + document 양쪽 capture phase 등록 (브라우저 누락 방어)
  // - textarea/input 포커스 중에도 동작 (blur 후 interrupt)
  useEffect(() => {
    const handleGlobalKeydown = (e) => {
      if (e.key !== 'Escape' && e.code !== 'Escape') return
      if (!isSpeakingRef.current) return
      e.preventDefault()
      e.stopPropagation()
      const target = e.target
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
        target.blur()
      }
      interruptAvatar()
    }
    window.addEventListener('keydown', handleGlobalKeydown, true)
    document.addEventListener('keydown', handleGlobalKeydown, true)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown, true)
      document.removeEventListener('keydown', handleGlobalKeydown, true)
    }
  }, [interruptAvatar])

  // ─── 아바타 종료 ───────────────────────────────────
  const stopAvatar = useCallback(async () => {
    // STT 중지
    autoListenRef.current = false
    setAutoListen(false)
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      try { recognitionRef.current.abort?.() } catch {}
      recognitionRef.current = null
    }
    setIsListening(false)

    // HeyGen 세션 종료 (best-effort)
    if (sessionRef.current) {
      try {
        await callProxy('streaming.stop', { session_id: sessionRef.current.session_id })
      } catch (e) { console.warn('streaming.stop error:', e) }
    }

    // LiveKit 연결 끊기
    if (roomRef.current) {
      try { await roomRef.current.disconnect() } catch {}
      roomRef.current = null
    }

    // 상태 리셋
    sessionRef.current     = null
    sessionIdRef.current   = null
    historyRef.current     = []
    setVideoReady(false)
    setStatus('idle')
    setMessages([])           // 채팅 초기화 — 깔끔하게 다시 시작
  }, [])

  // ─── 아바타 시작 ───────────────────────────────────
  const startAvatar = useCallback(async () => {
    setStatus('connecting')
    sessionIdRef.current = newSessionId()  // 새 세션 ID
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

      // 인사말 — 채팅 표시 + 아바타 발화
      const greetingText =
        '안녕하세요. 차의과학대학교 경영학전공 박대근 교수의 AI 면담 어시스턴트예요. ' +
        '전공 선택이나 진로에 대해 궁금한 점을 편하게 물어봐 주세요.'
      const greetingTts =
        '안녕하세요. 차 의과학 대학교 경영학 전공 박대근 교수의 에이아이 면담 어시스턴트예요. ' +
        '전공 선택이나 진로에 대해 궁금한 점을 편하게 물어봐 주세요.'

      setMessages([{ role: 'assistant', text: greetingText }])
      saveChat(sessionIdRef.current, 'assistant', greetingText)  // 인사말도 저장

      // 인사말 발화 (트랙 attach 직후엔 종종 첫 task 누락되므로 약간 지연)
      setTimeout(async () => {
        try {
          await callProxy('streaming.task', {
            session_id: sessionRef.current.session_id,
            text: greetingTts,
            task_type: 'repeat'
          })
        } catch (e) { console.error('greeting task error:', e) }
      }, 800)

      // 마이크 자동 활성화 (사용자 클릭(시작 버튼) 컨텍스트 안이라 권한 prompt 가능)
      if (initRecognition()) {
        autoListenRef.current = true
        setAutoListen(true)
        // 인사말 끝날 때까지 기다리고 마이크 켜기 (대략 8초 잡아둠 — 인사말 끝 이벤트로 더 정밀해짐)
        setTimeout(() => startListening(), 8000)
      }
    } catch (e) {
      console.error(e)
      setStatus('idle')
    }
  }, [initRecognition, startListening])

  return (
    <div className={styles.app}>
      <AvatarPanel
        status={status}
        videoRef={videoRef}
        videoReady={videoReady}
        onStart={startAvatar}
        onStop={stopAvatar}
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
        user={user}
        onLoginClick={() => setAuthOpen(true)}
        onLogout={handleLogout}
      />
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={(u) => setUser(u)}
      />
    </div>
  )
}
