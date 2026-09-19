import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ErrorDetailsDialog } from './ErrorDetailsDialog';

// House style: explicit vitest imports, so RTL's own hooks never register and are wired by hand
// (see `Preferences.test.tsx` for the reasoning).
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** What the dialog was asked to open, so the assertion is the call and not the browser. */
let opened: string[] = [];
const stubShell = (fail = false): void => {
  opened = [];
  (window as unknown as { shell: { openExternal(url: string): Promise<void> } }).shell = {
    openExternal: (url: string) => {
      opened.push(url);
      return fail ? Promise.reject(new Error('no channel')) : Promise.resolve();
    },
  };
};

afterEach(() => {
  cleanup();
  opened = [];
});

// Real output, copied rather than paraphrased: the whole point is which of git's own lines the
// authorisation is read out of. This is the message `catena-feed` refused a push with.
const SAML = [
  "remote: The 'Catena-Media' organization has enabled or enforced SAML SSO.",
  "remote: To access this repository, you must re-authorize the OAuth Application 'Git Credential Manager'.",
  "fatal: unable to access 'https://github.com/Catena-Media/catena-feed.git/': The requested URL returned error: 403",
].join('\n');

const BAD_PASSWORD = [
  'remote: Invalid username or password.',
  "fatal: unable to access 'https://github.com/Catena-Media/catena-feed.git/': The requested URL returned error: 403",
].join('\n');

const buttons = (): HTMLButtonElement[] => Array.from(document.querySelectorAll<HTMLButtonElement>('.modal-buttons .btn'));

describe('ErrorDetailsDialog', () => {
  it('offers the authorisation on an SSO refusal, showing where it goes', () => {
    stubShell();
    render(<ErrorDetailsDialog summary="Authentication failed for origin" detail={SAML} auth onClose={() => {}} />);

    const go = screen.getByTitle('https://github.com/settings/applications');
    expect(go.textContent).toContain('Authorise in browser');
    // Rightmost and primary: with somewhere to go, going there is what the dialog is asking for.
    expect(buttons().at(-1)).toBe(go);
    expect(go.className).toContain('primary');
    expect(screen.getByText('Close').className).not.toContain('primary');
  });

  it('says what to do on that page, and that the command has to be run again', () => {
    // The button on its own is what made this look like it had done nothing: a list of authorised
    // applications tells someone nothing about which row matters, and the browser reaches nothing
    // of the push that already failed.
    stubShell();
    render(<ErrorDetailsDialog summary="Authentication failed for origin" detail={SAML} auth onClose={() => {}} />);

    const note = screen.getByText(/Git Credential Manager/, { selector: '.modal-note' });
    expect(note.textContent).toMatch(/run the command again|authorise it afresh/);
  });

  it('opens that URL and nothing else when it is clicked', () => {
    stubShell();
    render(<ErrorDetailsDialog summary="Authentication failed for origin" detail={SAML} auth onClose={() => {}} />);

    act(() => {
      screen.getByTitle('https://github.com/settings/applications').click();
    });
    expect(opened).toEqual(['https://github.com/settings/applications']);
  });

  it('says so in the dialog when the channel refuses, the status bar being behind the backdrop', async () => {
    stubShell(true);
    render(<ErrorDetailsDialog summary="Authentication failed for origin" detail={SAML} auth onClose={() => {}} />);

    const go = screen.getByTitle('https://github.com/settings/applications');
    await act(async () => {
      go.click();
      await Promise.resolve();
    });
    expect(go.textContent).toContain('Could not open');
  });

  it('offers nothing to authorise on a credential failure that is not SSO', () => {
    stubShell();
    render(<ErrorDetailsDialog summary="Authentication failed for origin" detail={BAD_PASSWORD} auth onClose={() => {}} />);

    expect(screen.queryByText(/Authorise in browser/)).toBeNull();
    // The dialog is exactly what it was before: Copy, then Close as the primary.
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Copy', 'Close']);
    expect(buttons().at(-1)?.className).toContain('primary');
  });

  it('offers nothing on a failure that was never about a credential', () => {
    stubShell();
    // An SSO line in a message git did not blame on the credential is still not an SSO refusal:
    // `auth` is the main process's answer and this dialog does not second-guess it.
    render(<ErrorDetailsDialog summary="The command failed" detail={SAML} auth={false} onClose={() => {}} />);

    expect(screen.queryByText(/Authorise in browser/)).toBeNull();
    expect(screen.getByRole('heading').textContent).toBe('The command failed');
  });
});
