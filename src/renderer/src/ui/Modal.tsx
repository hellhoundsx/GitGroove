import { useEffect, useRef, useState, type JSX } from 'react';
import { matches } from '../shortcuts';

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
  /** Whether the text input must be non-empty for OK to be enabled (default true). */
  required?: boolean;
  /** Optional third button, between Cancel and OK. Resolves with `choice: 'secondary'`. */
  secondary?: { label: string };
}

export interface PromptResult {
  value: string;
  checked: boolean;
  /** Which button resolved the modal. `'secondary'` only when `options.secondary` was given. */
  choice: 'ok' | 'secondary';
}

interface Props {
  options: PromptOptions;
  onResolve(result: PromptResult | null): void;
}

export function Modal({ options, onResolve }: Props): JSX.Element {
  const hasInput = options.input !== false;
  const needsValue = hasInput && options.required !== false;
  const [value, setValue] = useState(options.defaultValue ?? '');
  const [checked, setChecked] = useState(options.checkbox?.defaultChecked ?? false);
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (hasInput ? inputRef.current : okRef.current)?.focus();
    inputRef.current?.select();
  }, [hasInput]);

  const resolveWith = (choice: 'ok' | 'secondary'): void => {
    if (needsValue && value.trim().length === 0) return;
    onResolve({ value: value.trim(), checked, choice });
  };
  const ok = (): void => resolveWith('ok');

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResolve(null);
      }}
      // Escape is not handled here: `App`'s window listener closes the topmost layer, so one
      // keystroke never also closes the diff or the find bar behind this dialog.
      onKeyDown={(e) => {
        if (matches('dialogConfirm', e) && !(e.target instanceof HTMLTextAreaElement)) {
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
          {options.secondary && (
            <button className="btn" disabled={needsValue && value.trim().length === 0} onClick={() => resolveWith('secondary')}>
              {options.secondary.label}
            </button>
          )}
          <button ref={okRef} className={`btn ${options.danger ? 'danger' : 'primary'}`} disabled={needsValue && value.trim().length === 0} onClick={ok}>
            {options.okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
