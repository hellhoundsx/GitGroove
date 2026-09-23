import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu';
import { Modal, type PromptOptions, type PromptResult } from './Modal';

export interface ConfirmOptions {
  title: string;
  message?: string;
  okLabel?: string;
  danger?: boolean;
  /**
   * An option the confirmation carries, rendered as the modal's checkbox row (GC-131). Only
   * `confirmWithOption` answers with the box's state; `confirm` returns a bare boolean and would
   * drop it, so a caller that needs the answer asks the other one.
   */
  checkbox?: { label: string; defaultChecked?: boolean };
}

/** What a confirmation carrying an option answers. `checked` is false whenever `confirmed` is. */
export interface ConfirmAnswer {
  confirmed: boolean;
  checked: boolean;
}

/**
 * Where a menu opens, and optionally the control it hangs off. A right-click menu passes the
 * event itself and leaves `owner` unset; a dropdown control passes its own element and gets a
 * menu that toggles, so a second click on it closes the menu instead of reopening it (GC-066).
 */
export interface MenuAnchor {
  clientX: number;
  clientY: number;
  preventDefault?(): void;
  owner?: Element | null;
}

export interface Ui {
  openMenu(at: MenuAnchor, items: MenuItem[]): void;
  prompt(options: PromptOptions): Promise<PromptResult | null>;
  confirm(options: ConfirmOptions): Promise<boolean>;
  /**
   * The same confirmation, asked when it carries an option: it answers whether the user confirmed
   * **and** what the checkbox said (GC-131). Before it, the only shape that could do this was
   * `prompt({ input: false, checkbox })` — which is what `confirm` is itself built on, so the
   * modal was already right and only the code read as a prompt.
   */
  confirmWithOption(options: ConfirmOptions): Promise<ConfirmAnswer>;
  /** True while a prompt or confirm modal is up, so `App` knows a dialog owns the keyboard. */
  dialogOpen: boolean;
  /** Cancels the open modal, resolving it with `null`. A no-op when none is open. */
  closeDialog(): void;
  /** True while a context menu is up: it is a layer like a dialog and owns Escape. */
  menuOpen: boolean;
  /** Closes the open context menu. A no-op when none is open. */
  closeMenu(): void;
}

const noop: Ui = {
  openMenu: () => undefined,
  prompt: async () => null,
  confirm: async () => false,
  confirmWithOption: async () => ({ confirmed: false, checked: false }),
  dialogOpen: false,
  closeDialog: () => undefined,
  menuOpen: false,
  closeMenu: () => undefined,
};

const UiContext = createContext<Ui>(noop);

export const useUi = (): Ui => useContext(UiContext);

export function UiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [modal, setModal] = useState<{ options: PromptOptions; resolve(r: PromptResult | null): void } | null>(null);
  // The control the open menu belongs to, and that same control when the mouse gesture in flight
  // started on it. Both are refs, not state: they are written by a DOM listener and read by
  // `openMenu` within one gesture, long before React re-renders (GC-066).
  const ownerRef = useRef<Element | null>(null);
  const armedRef = useRef<Element | null>(null);

  // `ContextMenu` dismisses on a capture-phase mousedown anywhere outside itself, so by the time
  // a dropdown's own click handler asks for the menu again it is already gone and `menuOpen` is
  // already false — a "close it if it is open" test in `openMenu` would never fire. This listener
  // is registered when the provider mounts, before any menu registers its own on the same node
  // and phase, so it runs first and is the last moment at which the menu can still be seen open:
  // it records that this gesture began on the control that owns it, and the click that follows
  // then closes the menu instead of reopening it (GC-066).
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const owner = ownerRef.current;
      armedRef.current = owner && e.target instanceof Node && owner.contains(e.target) ? owner : null;
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, []);

  const openMenu = useCallback<Ui['openMenu']>((at, items) => {
    at.preventDefault?.();
    const owner = at.owner ?? null;
    // A control toggles its own menu shut: either its mousedown has just dismissed it (`armed`),
    // or the click arrived without one — a synthetic `element.click()` — and the menu it owns is
    // still up (`ownerRef`). Both readings are of the same gesture, so both close (GC-066).
    if (owner && (armedRef.current === owner || ownerRef.current === owner)) {
      armedRef.current = null;
      ownerRef.current = null;
      setMenu(null);
      return;
    }
    if (items.length === 0) return;
    ownerRef.current = owner;
    setMenu({ x: at.clientX, y: at.clientY, items, anchored: owner !== null });
  }, []);

  const prompt = useCallback<Ui['prompt']>(
    (options) =>
      new Promise((resolve) => {
        setModal({
          options,
          resolve: (r) => {
            setModal(null);
            resolve(r);
          },
        });
      }),
    [],
  );

  // A confirmation is a prompt with the input switched off, and it always was: this is the one
  // place that knows it, so a caller wanting an option on the question no longer has to reach past
  // `confirm` for the shape underneath (GC-131).
  const confirmWithOption = useCallback<Ui['confirmWithOption']>(
    async (options) => {
      const r = await prompt({
        title: options.title,
        message: options.message,
        input: false,
        checkbox: options.checkbox,
        okLabel: options.okLabel ?? 'OK',
        danger: options.danger,
      });
      const confirmed = r !== null && r.choice === 'ok'; // a `secondary` button is never a plain confirmation
      return { confirmed, checked: confirmed && r.checked };
    },
    [prompt],
  );

  const confirm = useCallback<Ui['confirm']>(async (options) => (await confirmWithOption(options)).confirmed, [confirmWithOption]);

  // Escape is handled once, in `App`, for every layer; the modal and the context menu only have
  // to say they are there and offer a way to close them.
  const closeDialog = useCallback(() => modal?.resolve(null), [modal]);
  // Every close goes through here, so the owner is forgotten the moment its menu leaves the
  // screen and a later click on that control is a plain open again (GC-066).
  const closeMenu = useCallback(() => {
    ownerRef.current = null;
    setMenu(null);
  }, []);
  const value = useMemo<Ui>(
    () => ({ openMenu, prompt, confirm, confirmWithOption, dialogOpen: modal !== null, closeDialog, menuOpen: menu !== null, closeMenu }),
    [openMenu, prompt, confirm, confirmWithOption, modal, closeDialog, menu, closeMenu],
  );

  return (
    <UiContext.Provider value={value}>
      {children}
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {modal && <Modal options={modal.options} onResolve={modal.resolve} />}
    </UiContext.Provider>
  );
}
