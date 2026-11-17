import * as RDialog from '@radix-ui/react-dialog'
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Loader2, X } from 'lucide-react'
import { cx } from '@/lib/format'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const BTN: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 font-medium',
  secondary: 'bg-raised text-text border border-line hover:border-line-strong hover:bg-raised-2',
  ghost: 'text-text-2 hover:text-text hover:bg-raised',
  danger: 'bg-danger/12 text-danger border border-danger/30 hover:bg-danger/20'
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-[10px] whitespace-nowrap transition-[background,border-color,filter,color] duration-150 disabled:opacity-50',
          size === 'sm' ? 'h-8 px-3 text-[13px]' : size === 'lg' ? 'h-11 px-5 text-[15px]' : 'h-10 px-4 text-sm',
          BTN[variant],
          className
        )}
        {...rest}
      >
        {loading ? <Loader2 size={16} className="spin" aria-hidden /> : icon}
        {children}
      </button>
    )
  }
)

export function IconButton({ label, children, className, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx('inline-grid h-9 w-9 place-items-center rounded-[10px] text-text-2 transition-colors hover:bg-raised hover:text-text', active && 'bg-raised text-text', className)}
      {...rest}
    >
      {children}
    </button>
  )
}

const FIELD = 'w-full rounded-[10px] border border-line bg-raised px-3 text-sm text-text placeholder:text-text-3 transition-colors hover:border-line-strong focus:border-accent focus:outline-none'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(FIELD, 'h-10', className)} {...rest} />
})

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(FIELD, 'min-h-24 py-2 leading-relaxed', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(FIELD, 'h-10 appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' stroke='%23A9B7B5' fill='none' stroke-width='1.5'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  )
}

/** Label + control + helper/error text, wired for screen readers. */
export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-text-2">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-[13px] text-danger">{error}</p> : hint ? <p className="text-[13px] text-text-3">{hint}</p> : null}
    </div>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-150', checked ? 'border-accent bg-accent' : 'border-line-strong bg-raised')}
    >
      <span className={cx('absolute top-0.5 h-[18px] w-[18px] rounded-full transition-transform duration-150', checked ? 'translate-x-[22px] bg-accent-ink' : 'translate-x-0.5 bg-text-2')} />
    </button>
  )
}

/** Text tabs with a 2px accent underline (top-level navigation style). */
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('flex items-center gap-6', className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx('relative h-10 text-sm transition-colors', value === it.value ? 'text-text' : 'text-text-3 hover:text-text-2')}
        >
          {it.label}
          {it.count !== undefined && <span className="num ml-1.5 text-text-3">{it.count}</span>}
          <span className={cx('absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent transition-opacity', value === it.value ? 'opacity-100' : 'opacity-0')} />
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[12px] border border-line bg-bg/60 p-1">
      {items.map((it) => (
        <button
          key={it.value}
          role="radio"
          aria-checked={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx('h-8 rounded-[9px] px-3 text-[13px] transition-colors', value === it.value ? 'bg-raised-2 text-text' : 'text-text-3 hover:text-text-2')}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

const TONE = {
  neutral: 'bg-raised text-text-2 border-line',
  accent: 'bg-accent/12 text-accent border-accent/25',
  success: 'bg-success/12 text-success border-success/25',
  warning: 'bg-warning/12 text-warning border-warning/25',
  danger: 'bg-danger/12 text-danger border-danger/25',
  info: 'bg-info/12 text-info border-info/25'
} as const
export type Tone = keyof typeof TONE

export function Badge({ tone = 'neutral', children, icon, className }: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap', TONE[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('spin text-text-3', className)} aria-label="Loading" />
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="grid h-12 w-12 place-items-center rounded-2xl bg-raised text-text-2">{icon}</div>}
      <h3 className="font-display text-lg">{title}</h3>
      {body && <p className="max-w-md text-text-3">{body}</p>}
      {action}
    </div>
  )
}

export function Dialog({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" />
        <RDialog.Content className={cx('glass rise fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] p-6', wide ? 'max-w-3xl' : 'max-w-lg')}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RDialog.Title className="font-display text-xl">{title}</RDialog.Title>
              {description && <RDialog.Description className="mt-1 text-text-3">{description}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <IconButton label="Close">
                <X size={18} />
              </IconButton>
            </RDialog.Close>
          </div>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-[20px] font-medium">{children}</h2>
      {action}
    </div>
  )
}
