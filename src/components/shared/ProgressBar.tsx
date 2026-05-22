interface Props { value: number; height?: number; className?: string }

export function ProgressBar({ value, height = 5, className = '' }: Props) {
  return (
    <div className={`flex items-center gap-[5px] w-full ${className}`}>
      <div
        className="flex-1 rounded-full overflow-hidden bg-gray-200"
        style={{ height }}
      >
        <div
          className="h-full rounded-full bg-[#007aff] transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-500 min-w-[26px]">{value}%</span>
    </div>
  )
}
