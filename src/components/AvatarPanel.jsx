import styles from './AvatarPanel.module.css'

const STATUS_MAP = {
  idle:       { label: '대기 중',   dot: 'gray'  },
  connecting: { label: '연결 중…', dot: 'yellow' },
  connected:  { label: '연결됨',   dot: 'green' },
  speaking:   { label: '말하는 중', dot: 'blue'  },
}

const MODE_OPTIONS = [
  { value: 'ftf', label: 'FTF', sub: '화상' },
  { value: 'sts', label: 'STS', sub: '음성' },
  { value: 'ttt', label: 'TTT', sub: '텍스트' },
]

export default function AvatarPanel({
  status,
  mode,
  onModeChange,
  videoRef,
  userVideoRef,
  videoReady,
  cameraActive,
  onStart,
  onStop,
  onInterrupt
}) {
  const mappedStatus = STATUS_MAP[status] || STATUS_MAP.idle
  const label = mode === 'ttt' && status === 'connected' ? '텍스트 대화' : mappedStatus.label
  const dot = mappedStatus.dot
  const showAvatarVideo = mode === 'ftf'
  const showVoiceOnly = mode === 'sts'
  const showTextOnly = mode === 'ttt'
  const startLabel = mode === 'ttt' ? '텍스트 시작' : mode === 'sts' ? '음성 시작' : '화상 시작'

  return (
    <div className={styles.panel}>
      {/* 배경 그라디언트 오브 */}
      <div className={styles.orb} />

      {/* 비디오 */}
      <div className={styles.videoRow}>
        <div className={styles.videoWrap}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className={styles.video}
            style={{ opacity: showAvatarVideo && videoReady ? 1 : 0 }}
          />
          {showAvatarVideo && !videoReady && (
            <div className={styles.placeholder}>
              <div className={styles.avatarIcon}>
                <span>👨‍🏫</span>
              </div>
              <p className={styles.placeholderText}>박대근 교수</p>
              <p className={styles.placeholderSub}>차의과학대학교 신입생 담임교수</p>
            </div>
          )}
          {showVoiceOnly && (
            <div className={styles.modePlaceholder}>
              <div className={styles.modeIcon}>STS</div>
              <p className={styles.placeholderText}>음성 대화</p>
              <p className={styles.placeholderSub}>영상 없이 말로 상담</p>
            </div>
          )}
          {showTextOnly && (
            <div className={styles.modePlaceholder}>
              <div className={styles.modeIcon}>TTT</div>
              <p className={styles.placeholderText}>텍스트 대화</p>
              <p className={styles.placeholderSub}>마이크와 소리 없이 채팅</p>
            </div>
          )}

          {/* 하단 네임플레이트 */}
          {showAvatarVideo && videoReady && (
            <div className={styles.nameplate}>
              <div className={styles.nameplateInner}>
                <span className={styles.nameplateName}>박대근 교수</span>
                <span className={styles.nameplateSub}>차의과학대학교 신입생 담임교수</span>
              </div>
            </div>
          )}

          {/* 발화 중 글로우 */}
          {status === 'speaking' && <div className={styles.speakGlow} />}
        </div>

        {mode === 'ftf' && (
          <div className={`${styles.cameraWrap} ${cameraActive ? styles.cameraOn : ''}`}>
            <video
              ref={userVideoRef}
              autoPlay
              muted
              playsInline
              className={styles.cameraVideo}
              style={{ opacity: cameraActive ? 1 : 0 }}
            />
            {!cameraActive && <span className={styles.cameraLabel}>CAM</span>}
          </div>
        )}
      </div>

      <div className={styles.modeSwitch} role="group" aria-label="대화 모드 선택">
        {MODE_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            className={`${styles.modeBtn} ${mode === option.value ? styles.modeBtnActive : ''}`}
            onClick={() => onModeChange?.(option.value)}
            disabled={status === 'connecting'}
            aria-pressed={mode === option.value}
            title={`${option.label} ${option.sub}`}
          >
            <span className={styles.modeLabel}>{option.label}</span>
            <span className={styles.modeSub}>{option.sub}</span>
          </button>
        ))}
      </div>

      {/* 상태 배지 */}
      {status === 'speaking' ? (
        <button className={styles.interruptBtn} onClick={onInterrupt} type="button" aria-label="말 멈추기">
          <span className={`${styles.dot} ${styles[dot]}`} />
          <span className={styles.pauseIcon}>||</span>
          <span className={styles.statusLabel}>말 멈추기</span>
        </button>
      ) : (
        <div className={styles.statusRow}>
          <span className={`${styles.dot} ${styles[dot]}`} />
          <span className={styles.statusLabel}>{label}</span>
        </div>
      )}

      {/* 시작 버튼 */}
      {status === 'idle' && (
        <button className={styles.startBtn} onClick={onStart}>
          <span className={styles.startBtnIcon}>▶</span>
          {startLabel}
        </button>
      )}
      {status === 'connecting' && (
        <button className={styles.startBtn} disabled>
          <span className={styles.spinner} /> 연결 중…
        </button>
      )}
      {(status === 'connected' || status === 'speaking') && (
        <button
          className={styles.stopBtn}
          onClick={() => {
            if (window.confirm('대화를 종료할까요? 채팅 기록은 초기화돼요.')) onStop?.()
          }}
        >
          <span className={styles.startBtnIcon}>■</span>
          대화 종료
        </button>
      )}
    </div>
  )
}
