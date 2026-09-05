import { useEffect, useState } from 'react';

// Gravatar lookups by SHA-256 of the lowercased email. Results are cached for the session and
// URLs that returned 404 are remembered so scrolling a virtualised list does not re-request them.

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const failed = new Set<string>();

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function gravatarUrl(email: string, size = 40): Promise<string> {
  const key = email.trim().toLowerCase();
  const cached = urls.get(key);
  if (cached) return Promise.resolve(cached);
  let p = pending.get(key);
  if (!p) {
    p = sha256Hex(key).then((hash) => {
      const url = `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
      urls.set(key, url);
      pending.delete(key);
      return url;
    });
    pending.set(key, p);
  }
  return p;
}

export const markAvatarFailed = (url: string): void => void failed.add(url);
export const avatarFailed = (url: string): boolean => failed.has(url);

/** Resolves to a Gravatar URL for the email, or null while computing / when the avatar is known to be missing. */
export function useGravatar(email: string | undefined): string | null {
  const key = email?.trim().toLowerCase() ?? '';
  const [url, setUrl] = useState<string | null>(() => (key ? urls.get(key) ?? null : null));
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void gravatarUrl(key).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return url && !failed.has(url) ? url : null;
}

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
