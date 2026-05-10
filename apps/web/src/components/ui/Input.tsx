import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, className, id: idProp, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  const errId = `${id}-err`;

  const { 'aria-describedby': callerDescribedBy, ...restProps } = rest;
  const describedBy =
    [error ? errId : null, callerDescribedBy].filter(Boolean).join(' ') || undefined;

  return (
    <label className="block">
      {label && <span className="label" id={`${id}-label`}>{label}</span>}
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn('input', error && 'border-danger focus:border-danger focus:ring-danger/20', className)}
        {...restProps}
      />
      {error && (
        <span id={errId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
});
