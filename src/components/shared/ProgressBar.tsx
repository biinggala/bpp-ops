interface Props { value: number; height?: number }

export function ProgressBar({ value, height = 5 }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
      <div style={{ flex: 1, height, background: 'var(--bg4)', borderRadius: height }}>
        <div style={{ width: `${value}%`, height: '100%', background: 'var(--ac)', borderRadius: height, transition: 'width .2s' }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--t3)', minWidth: 28, textAlign: 'right' }}>{value}%</span>
    </div>
  )
}
