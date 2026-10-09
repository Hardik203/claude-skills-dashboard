interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  pending?: boolean
}

export function Switch({ checked, onChange, label, disabled, pending }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${pending ? ' switch-pending' : ''}`}
      disabled={disabled || pending}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
    >
      <span className="switch-thumb" />
    </button>
  )
}
