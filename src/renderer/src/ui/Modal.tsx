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
  /**
   * A button inside the field that fills it in (GC-221). It answers the *field*, so it belongs to
   * the field: the clone dialog's "Browse…" picks the folder for "Clone into" and nothing else,
   * and as a third button beside Cancel and Clone it read as a third answer to the dialog.
   *
   * `pick` resolves with the value, or `null` when the user backed out — and the dialog **stays
   * open** throughout, which is what replaced GC-185's arrangement: that closed the dialog,
   * reopened it with the answer, and needed `fillsIn` so the button was not gated on the form it
   * was there to complete. A field that fills itself in needs none of that.
   */
  pick?: { label: string; run: () => Promise<string | null> };
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
   * It is gated on the form being complete, like OK, because it **answers** the dialog.
   *
   * It used to carry `fillsIn` for a button that supplied part of the answer instead — the clone
   * dialog's "Browse…", which was that dialog closed and reopened with the folder the OS picker
   * returned (GC-185). A field fills itself in now (`PromptField.pick`, GC-221), which is where
   * such a button belongs, so nothing needs the exception and it went with it.
   */
  secondary?: { label: string };
  /**
   * A line under the fields that answers what the dialog is about to do, recomputed as the user
   * types (GC-221). The clone dialog is the caller: a URL and a parent folder do not say where the
   * repository will land, and the sentence explaining that it lands in a new folder inside the one
   * you choose was the dialog describing its own behaviour instead of showing it.
   *
   * `null` means there is nothing to say yet — an empty form, or a URL nothing can be read out of
   * — and the line is absent rather than empty, so a dialog that has not been filled in looks
   * exactly as it did.
   */
  note?: (values: Record<string, string>) => string | null;
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
  // Derived on every render rather than kept in state: it is a function of what is typed, and the
  // one thing it must never be is a frame behind the field it describes (GC-221).
  const note = options.note ? options.note(Object.fromEntries(fields.map((f) => [f.name, (values[f.name] ?? '').trim()]))) : null;

  useEffect(() => {
    (hasInput ? inputRef.current : okRef.current)?.focus();
    inputRef.current?.select();
  }, [hasInput]);

  const resolveWith = (choice: 'ok' | 'secondary'): void => {
    if (incomplete) return;
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
                {/* The input and its own picker share a row, so the button reads as belonging to
                    this field rather than as a third answer to the dialog (GC-221). */}
                <div className="modal-field-row">
                  <input
                    ref={i === 0 ? inputRef : undefined}
                    name={f.name}
                    value={values[f.name] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                    spellCheck={false}
                  />
                  {f.pick && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        // The dialog stays open: this answers the field, not the question.
                        void f.pick?.run().then((picked) => {
                          if (picked !== null) setValues((v) => ({ ...v, [f.name]: picked }));
                        });
                      }}
                    >
                      {f.pick.label}
                    </button>
                  )}
                </div>
              </label>
            ))}
            {note !== null && <p className="modal-note-line">{note}</p>}
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
            <button className="btn" disabled={incomplete} onClick={() => resolveWith('secondary')}>
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
