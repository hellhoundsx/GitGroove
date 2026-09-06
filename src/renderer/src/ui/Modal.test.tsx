import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal, promptFields, type PromptResult } from './Modal';

// GC-026 gave the dialog several fields. The half that matters is that the single-field form did
// not move: every caller in the app asks for one thing, and `result.value` is what they all read.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(cleanup);

const okButton = (): HTMLButtonElement => document.querySelector('.modal-buttons .btn:last-child') as HTMLButtonElement;
const field = (name: string): HTMLInputElement => document.querySelector(`.modal-field input[name="${name}"]`) as HTMLInputElement;
// Cancel, then the secondary, then OK — the order `.modal-buttons` renders them in.
const secondaryButton = (): HTMLButtonElement => document.querySelectorAll('.modal-buttons .btn')[1] as HTMLButtonElement;

describe('promptFields', () => {
  it('reads the single-field options as one field named value', () => {
    expect(promptFields({ title: 't', label: 'URL', defaultValue: 'x', placeholder: 'p' })).toEqual([
      { name: 'value', label: 'URL', defaultValue: 'x', placeholder: 'p', required: undefined },
    ]);
  });

  it('is no fields at all for a confirmation', () => {
    expect(promptFields({ title: 't', input: false })).toEqual([]);
  });

  it('passes several fields through untouched', () => {
    const fields = [{ name: 'name' }, { name: 'url', required: false }];
    expect(promptFields({ title: 't', fields })).toBe(fields);
  });
});

describe('Modal', () => {
  it('answers a single-field dialog on both value and values, as every existing caller reads it', () => {
    let result: PromptResult | null = null;
    render(<Modal options={{ title: 'Edit origin', label: 'URL', defaultValue: 'https://old' }} onResolve={(r) => (result = r)} />);

    fireEvent.change(field('value'), { target: { value: '  https://new  ' } });
    fireEvent.click(okButton());

    expect(result).toEqual({ value: 'https://new', values: { value: 'https://new' }, checked: false, choice: 'ok' });
  });

  it('asks for several things at once and answers them keyed by name', () => {
    let result: PromptResult | null = null;
    render(
      <Modal
        options={{
          title: 'Add remote',
          okLabel: 'Add',
          fields: [
            { name: 'name', label: 'Remote name' },
            { name: 'url', label: 'URL' },
          ],
        }}
        onResolve={(r) => (result = r)}
      />,
    );

    expect(document.querySelectorAll('.modal-field').length).toBe(2);
    expect(screen.getByText('Add')).toBeTruthy();

    fireEvent.change(field('name'), { target: { value: 'upstream' } });
    fireEvent.change(field('url'), { target: { value: 'https://host/o/r.git' } });
    fireEvent.click(okButton());

    expect(result).toEqual({
      value: 'upstream',
      values: { name: 'upstream', url: 'https://host/o/r.git' },
      checked: false,
      choice: 'ok',
    });
  });

  it('waits for every required field, not only the first', () => {
    render(
      <Modal options={{ title: 'Add remote', fields: [{ name: 'name' }, { name: 'url' }] }} onResolve={() => undefined} />,
    );

    expect(okButton().disabled).toBe(true);
    fireEvent.change(field('name'), { target: { value: 'upstream' } });
    expect(okButton().disabled).toBe(true);
    fireEvent.change(field('url'), { target: { value: 'https://host/o/r.git' } });
    expect(okButton().disabled).toBe(false);
  });

  it('does not wait for a field that said it was optional', () => {
    let result: PromptResult | null = null;
    render(
      <Modal
        options={{ title: 'Tag', fields: [{ name: 'name' }, { name: 'message', required: false }] }}
        onResolve={(r) => (result = r)}
      />,
    );

    fireEvent.change(field('name'), { target: { value: 'v1' } });
    expect(okButton().disabled).toBe(false);
    fireEvent.click(okButton());
    expect(result).toEqual({ value: 'v1', values: { name: 'v1', message: '' }, checked: false, choice: 'ok' });
  });

  // GC-185: the third button is not always an answer. The clone dialog's "Browse…" supplies the
  // folder the form is waiting for, so gating it on the form being complete made the folder picker
  // unreachable from a cold dialog, which is every first clone. The two guard dialogs' secondaries
  // do answer their question and must stay gated.
  it('keeps a secondary that fills the form in live while a required field is empty', () => {
    let result: PromptResult | null = null;
    render(
      <Modal
        options={{
          title: 'Clone repository',
          okLabel: 'Clone',
          fields: [{ name: 'url' }, { name: 'parent' }],
          secondary: { label: 'Browse…', fillsIn: true },
        }}
        onResolve={(r) => (result = r)}
      />,
    );

    expect(secondaryButton().disabled).toBe(false);
    expect(okButton().disabled).toBe(true);

    // and clicking it resolves: `resolveWith`'s own guard has to agree with the button, or a live
    // button does nothing.
    fireEvent.click(secondaryButton());
    expect(result).toEqual({ value: '', values: { url: '', parent: '' }, checked: false, choice: 'secondary' });
  });

  it('gates an ordinary secondary on the form being complete, as the two guards rely on', () => {
    let result: PromptResult | null = null;
    render(<Modal options={{ title: 'Rename', fields: [{ name: 'name' }], secondary: { label: 'Something else' } }} onResolve={(r) => (result = r)} />);

    expect(secondaryButton().disabled).toBe(true);
    fireEvent.click(secondaryButton());
    expect(result).toBe(null);

    fireEvent.change(field('name'), { target: { value: 'v2' } });
    expect(secondaryButton().disabled).toBe(false);
  });

  it('focuses the first field', () => {
    render(<Modal options={{ title: 'Add remote', fields: [{ name: 'name' }, { name: 'url' }] }} onResolve={() => undefined} />);
    expect(document.activeElement).toBe(field('name'));
  });
});
