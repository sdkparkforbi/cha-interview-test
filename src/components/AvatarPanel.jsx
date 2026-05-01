import styles from './AvatarPanel.module.css'

const STATUS_MAP = {
  idle:       { label: '대기 중',   dot: 'gray'  },
  connecting: { label: '연결 중…', dot: 'yellow' },
  connected:  { label: '연결됨',   dot: 'green' },
  speaking:   { label: '말하는 중', dot: 'blue'  },
}

export default function AvatarPanel({ status, videoRef, videoReady, onStart }) {
  const { label, dot } = STATUS_MAP[status] || STATUS_MAP.idle

  return (
    <div className={styles.panel}>
      {/* 배경 그라디언트 오브 */}
      <div className={styles.orb} />

      {/* 비디오 */}
      <div className={styles.videoWrap}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={styles.video}
          style={{ opacity: videoReady ? 1 : 0 }}
        />
        {!videoReady && (
          <div className={styles.placeholder}>
            <div className={styles.avatarIcon}>
              <span>👨‍🏫</span>
            </div>
            <p className={styles.placeholderText}>박대근 교수</p>
            <p className={styles.placeholderSub}>차의과학대학교 경영학전공</p>
          </div>
        )}

        {/* 하단 네임플레이트 */}
        {videoReady && (
          <div className={styles.nameplate}>
            <div className={styles.nameplateInner}>
              <span className={styles.nameplateName}>박대근 교수</span>
              <span className={styles.nameplateSub}>차의과학대학교 경영학전공</span>
            </div>
          </div>
        )}

        {/* 발화 중 글로우 */}
        {status === 'speaking' && <div className={styles.speakGlow} />}
      </div>

      {/* 상태 배지 */}
      <div className={styles.statusRow}>
        <span className={`${styles.dot} ${styles[dot]}`} />
        <span className={styles.statusLabel}>{label}</span>
      </div>

      {/* 시작 버튼 */}
      {status === 'idle' && (
        <button className={styles.startBtn} onClick={onStart}>
          <span className={styles.startBtnIcon}>▶</span>
          아바타 시작
        </button>
      )}
      {status === 'connecting' && (
        <button className={styles.startBtn} disabled>
          <span className={styles.spinner} /> 연결 중…
        </button>
      )}
    </div>
  )
}
