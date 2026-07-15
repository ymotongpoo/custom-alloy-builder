import type { ConnectionLineComponentProps } from '@xyflow/react'

export function ConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  connectionStatus,
}: ConnectionLineComponentProps) {
  const stroke = connectionStatus === 'valid' ? '#16a34a' : connectionStatus === 'invalid' ? '#dc2626' : '#2563eb'

  return (
    <g className={`connection-line connection-line-${connectionStatus ?? 'unknown'}`}>
      <path
        d={`M ${fromX},${fromY} C ${(fromX + toX) / 2},${fromY} ${(fromX + toX) / 2},${toY} ${toX},${toY}`}
        fill="none"
        stroke={stroke}
        strokeLinecap="round"
        strokeWidth={3}
      />
    </g>
  )
}
