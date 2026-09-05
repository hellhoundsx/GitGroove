import { useState, type JSX } from 'react';
import { initialsOf, markAvatarFailed, useGravatar } from './avatars';

interface Props {
  name: string;
  email?: string;
  size?: number;
  className?: string;
}

/** Square avatar for panels: Gravatar when available, initials otherwise. */
export function Avatar({ name, email, size = 40, className = '' }: Props): JSX.Element {
  const url = useGravatar(email);
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (url && !broken) {
    return (
      <img
        className={`avatar ${className}`}
        style={style}
        src={url}
        alt={name}
        title={email}
        onError={() => {
          markAvatarFailed(url);
          setBroken(true);
        }}
      />
    );
  }
  return (
    <div className={`avatar ${className}`} style={style} title={email}>
      {initialsOf(name)}
    </div>
  );
}
