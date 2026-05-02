import { useState } from 'react'
import styles from './AuthModal.module.css'
import { emailLogin, emailSignup } from '../lib/api'

export default function AuthModal({ open, onClose, onSuccess }) {
  const [mode, setMode]         = useState('login')   // 'login' | 'signup'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]         = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  if (!open) return null

  const submit = async () => {
    setError('')
    if (!email || !password) { setError('이메일과 비밀번호를 입력해 주세요.'); return }
    if (mode === 'signup' && !name) { setError('이름을 입력해 주세요.'); return }
    setLoading(true)
    try {
      const r = mode === 'login'
        ? await emailLogin(email, password)
        : await emailSignup(email, password, name)
      if (!r.success) { setError(r.error || '로그인에 실패했어요.'); setLoading(false); return }
      onSuccess?.(r.user)
      onClose?.()
    } catch (e) {
      setError('네트워크 오류가 발생했어요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`}
            onClick={() => { setMode('login'); setError('') }}
          >로그인</button>
          <button
            className={`${styles.tab} ${mode === 'signup' ? styles.tabActive : ''}`}
            onClick={() => { setMode('signup'); setError('') }}
          >회원가입</button>
        </div>

        <div className={styles.body}>
          {mode === 'signup' && (
            <input
              className={styles.input}
              placeholder="이름"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          )}
          <input
            className={styles.input}
            type="email"
            placeholder="이메일"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <input
            className={styles.input}
            type="password"
            placeholder="비밀번호 (6자 이상)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />

          {error && <div className={styles.error}>{error}</div>}

          <button
            className={styles.submitBtn}
            onClick={submit}
            disabled={loading}
          >
            {loading ? '처리 중…' : (mode === 'login' ? '로그인' : '회원가입')}
          </button>

          <div className={styles.divider}><span>또는</span></div>

          <button className={styles.kakaoBtn} disabled title="준비 중">
            카카오로 시작 (준비 중)
          </button>

          <button className={styles.guestBtn} onClick={onClose}>
            로그인 없이 사용하기
          </button>
        </div>
      </div>
    </div>
  )
}
