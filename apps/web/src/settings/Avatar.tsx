import { useState } from 'react';
import type { User } from 'firebase/auth';

/** The user's Google photo, or their initial when there is none or it fails to load. */
export function Avatar({ user, size }: { user: User; size: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (user.displayName || user.email || '?').trim().charAt(0).toUpperCase();
  return user.photoURL && !broken ? (
    <img
      className="st-avatar"
      src={user.photoURL}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    // The size goes through a CSS variable, not inline width/height, so a stylesheet rule
    // (the smaller account button on phones) can still resize it.
    <span className="st-avatar st-initial" style={{ ['--avatar' as string]: `${size}px` }} aria-hidden="true">
      {initial}
    </span>
  );
}
