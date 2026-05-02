import { useState, useRef, useEffect } from 'react'
import styles from './ChatPanel.module.css'

function TypingDots() {
  return (
    <div className={styles.typingDots}>
      <span /><span /><span />
    </div>
  )
}

function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`${styles.msgRow} ${isUser ? styles.userRow : styles.assistantRow}`}>
      {!isUser && (
        <div className={styles.avatar}>박</div>
      )}
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.assistantBubble}`}>
        {msg.text === null ? <TypingDots /> : msg.text}
      </div>
    </div>
  )
}

export default function ChatPanel({ messages, isProcessing, onSend, connected, isListening, onToggleMic, micEnabled, user, onLoginClick, onLogout }) {
  const [input, setInput]       = useState('')
  const bottomRef               = useRef(null)
  const textareaRef             = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isProcessing) return
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    onSend(text)
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
  }

  return (
    <div className={styles.panel}>
      {/* 헤더 */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>💬</span>
          <span className={styles.headerTitle}>면담 대화</span>
        </div>
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={styles.headerSub}>{user.name}님</span>
            <button
              onClick={onLogout}
              style={{ background: 'transparent', border: '1px solid #2a2a32', color: '#888', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
            >로그아웃</button>
          </div>
        ) : (
          <button
            onClick={onLoginClick}
            style={{ background: '#2a2a32', border: 'none', color: '#e6e6e6', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}
          >로그인</button>
        )}
      </div>

      {/* 메시지 목록 */}
      <div className={styles.messages}>
        {messages.map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 입력창 */}
      <div className={styles.inputArea}>
        <button
          type="button"
          className={styles.sendBtn}
          onClick={onToggleMic}
          disabled={!micEnabled}
          title={isListening ? '마이크 끄기' : '마이크 켜기'}
          style={isListening ? { background: '#dc2626', color: '#fff' } : undefined}
        >
          {isListening ? '■' : '🎤'}
        </button>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKey}
          placeholder={
            !connected ? '먼저 [아바타 시작] 버튼을 눌러주세요'
            : isListening ? '듣고 있어요…'
            : '궁금한 점을 입력하세요…'
          }
          rows={1}
          disabled={isProcessing || !connected}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={isProcessing || !input.trim() || !connected}
        >
          {isProcessing ? <span className={styles.spinner} /> : '↑'}
        </button>
      </div>

      {/* 하단 힌트 */}
      <div className={styles.hint}>
        Enter로 전송 · Shift+Enter 줄바꿈 · 🎤 누르면 음성 대화
      </div>
    </div>
  )
}
