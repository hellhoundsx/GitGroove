import { useEffect, useRef, useState, type JSX } from 'react';
import { matches } from '../shortcuts';

/**
 * One field of a dialog that asks for several things at once (GC-026). `name` is the key its
 * answer takes in `PromptResult.values`, and is also the input's `name`, so a driver can fill one
 * field by name rather than by position.
 */
export interface PromptField {
  name: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Whether OK waits for this field (default true). */
  required?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  /** Show a text input (default true). Set false for a plain confirmation. */
  input?: boolean;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  /**
   * Ask for several things in one dialog instead of one (GC-026). When given, the four
   * single-field options above are ignored: each field carries its own.
   */
  fields?: PromptField[];
  checkbox?: { label: string; defaultChecked?: boolean };
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Whether the text input must be non-empty for OK to be enabled (default true). */
  required?: boolean;
  /**
   * Optional third button, between Cancel and OK. Resolves with `choice: 'secondary'`.
   *
   * `fillsIn` says the button does not **answer** the question but supplies part of the answer —
   * the clone dialog's "Browse…", which is that dialog reopened with the folder the OS picker
   * returned (GC-185). Such a button is not gated on the form being complete, because the form
   * being incomplete is exactly when it is wanted; the two guard dialogs' secondaries do answer
   * their question and stay gated, which is why the distinction lives here rather than as a
   * special case in `App`. Omitted means an answer.
   */
  secondary?: { label: string; fillsIn?: boolean };
}

export interface PromptResult {
  /** The first field's answer, which for a single-field dialog is the whole of it. */
  value: string;
  /** Every field's answer, keyed by `PromptField.name` (GC-026). */
  values: Record<string, string>;
  checked: boolean;
  /** Which button resolved the modal. `'secondary'` only when `options.secondary` was given. */
  choice: 'ok' | 'secondary';
}

/**
 * What a dialog actually renders, so the rest of the component knows only about fields (GC-026).
 * The single-field form is one field named `value` built from the top-level options, which is why
 * no existing caller had to move: `result.value` is still the first field's answer, and
 * `input: false` is still no fields at all.
 */
export function promptFields(options: PromptOptions): PromptField[] {
  if (options.fields) return options.fields;
  if (options.input === false) return [];
  return [{ name: 'value', label: options.label, defaultValue: options.defaultValue, placeholder: options.placeholder, required: options.required }];
}

interface Props {
  options: PromptOptions;
  onResolve(result: PromptResult | null): void;
}

export function Modal({ options, onResolve }: Props): JSX.Element {
  const fields = promptFields(options);
  const hasInput = fields.length > 0;
  const hasBody = Boolean(options.message) || hasInput || Boolean(options.checkbox);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? ''])));
  const [checked, setChecked] = useState(options.checkbox?.defaultChecked ?? false);
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  // OK waits for every field that asked to be waited for, not only the first: a dialog with two
  // fields is not answered until both are (GC-026).
  const incomplete = fields.some((f) => f.required !== false && (values[f.name] ?? '').trim().length === 0);

  useEffect(() => {
    (hasInput ? inputRef.current : okRef.current)?.focus();
    inputRef.current?.select();
  }, [hasInput]);

  // A secondary that fills the form in is live while the form is incomplete, so this guard has to
  // agree with the button or a live button would do nothing when clicked (GC-185).
  const fillsIn = (choice: 'ok' | 'secondary'): boolean => choice === 'secondary' && options.secondary?.fillsIn === true;

  const resolveWith = (choice: 'ok' | 'secondary'): void => {
    if (incomplete && !fillsIn(choice)) return;
    const answers = Object.fromEntries(fields.map((f) => [f.name, (values[f.name] ?? '').trim()]));
    onResolve({ value: fields.length > 0 ? (answers[fields[0].name] ?? '') : '', values: answers, checked, choice });
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
        {/* Only rendered when there is something to put in it: an empty body would still take a
            gap, and a title-only dialog must look exactly as it did (GC-103). */}
        {hasBody && (
          <div className="modal-body">
            {options.message && <p className="modal-message">{options.message}</p>}
            {fields.map((f, i) => (
              <label className="modal-field" key={f.name}>
                {f.label && <span>{f.label}</span>}
                <input
                  ref={i === 0 ? inputRef : undefined}
                  name={f.name}
                  value={values[f.name] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  spellCheck={false}
                />
              </label>
            ))}
            {options.checkbox && (
              <label className="modal-check">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {options.checkbox.label}
              </label>
            )}
          </div>
        )}
        <div className="modal-buttons">
          <button className="btn" onClick={() => onResolve(null)}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          {options.secondary && (
            <button className="btn" disabled={incomplete && !fillsIn('secondary')} onClick={() => resolveWith('secondary')}>
              {options.secondary.label}
            </button>
          )}
          <button ref={okRef} className={`btn ${options.danger ? 'danger' : 'primary'}`} disabled={incomplete} onClick={ok}>
            {options.okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
