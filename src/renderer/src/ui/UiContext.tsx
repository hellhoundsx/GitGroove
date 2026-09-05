import { createContext, useCallback, useContext, useMemo, useState, type JSX, type ReactNode } from 'react';
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu';
import { Modal, type PromptOptions, type PromptResult } from './Modal';

export interface ConfirmOptions {
  title: string;
  message?: string;
  okLabel?: string;
  danger?: boolean;
}

export interface Ui {
  openMenu(at: { clientX: number; clientY: number; preventDefault?(): void }, items: MenuItem[]): void;
  prompt(options: PromptOptions): Promise<PromptResult | null>;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

const noop: Ui = {
  openMenu: () => undefined,
  prompt: async () => null,
  confirm: async () => false,
};

const UiContext = createContext<Ui>(noop);

export const useUi = (): Ui => useContext(UiContext);

export function UiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [modal, setModal] = useState<{ options: PromptOptions; resolve(r: PromptResult | null): void } | null>(null);

  const openMenu = useCallback<Ui['openMenu']>((at, items) => {
    at.preventDefault?.();
    if (items.length === 0) return;
    setMenu({ x: at.clientX, y: at.clientY, items });
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

  const confirm = useCallback<Ui['confirm']>(
    async (options) => {
      const r = await prompt({ title: options.title, message: options.message, input: false, okLabel: options.okLabel ?? 'OK', danger: options.danger });
      return r !== null;
    },
    [prompt],
  );

  const value = useMemo<Ui>(() => ({ openMenu, prompt, confirm }), [openMenu, prompt, confirm]);
  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <UiContext.Provider value={value}>
      {children}
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {modal && <Modal options={modal.options} onResolve={modal.resolve} />}
    </UiContext.Provider>
  );
}
