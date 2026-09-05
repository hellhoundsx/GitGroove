import { useEffect, useRef, useState, type JSX } from 'react';

export interface PromptOptions {
  title: string;
  message?: string;
  /** Show a text input (default true). Set false for a plain confirmation. */
  input?: boolean;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  checkbox?: { label: string; defaultChecked?: boolean };
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptResult {
  value: string;
  checked: boolean;
}

interface Props {
  options: PromptOptions;
  onResolve(result: PromptResult | null): void;
}

export function Modal({ options, onResolve }: Props): JSX.Element {
  const hasInput = options.input !== false;
  const [value, setValue] = useState(options.defaultValue ?? '');
  const [checked, setChecked] = useState(options.checkbox?.defaultChecked ?? false);
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (hasInput ? inputRef.current : okRef.current)?.focus();
    inputRef.current?.select();
  }, [hasInput]);

  const ok = (): void => {
    if (hasInput && value.trim().length === 0) return;
    onResolve({ value: value.trim(), checked });
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResolve(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onResolve(null);
        if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          ok();
        }
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">{options.title}</h3>
        {options.message && <p className="modal-message">{options.message}</p>}
        {hasInput && (
          <label className="modal-field">
            {options.label && <span>{options.label}</span>}
            <input ref={inputRef} value={value} placeholder={options.placeholder} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
          </label>
        )}
        {options.checkbox && (
          <label className="modal-check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {options.checkbox.label}
          </label>
        )}
        <div className="modal-buttons">
          <button className="btn" onClick={() => onResolve(null)}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button ref={okRef} className={`btn ${options.danger ? 'danger' : 'primary'}`} disabled={hasInput && value.trim().length === 0} onClick={ok}>
            {options.okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
