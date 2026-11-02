/**
 * Small haptic cues. Android and other browsers with the Vibration API get a short buzz; iOS
 * Safari 18+ gets the system "tick" that toggling an `<input type="checkbox" switch>` plays.
 * Elsewhere every call does nothing. The settings screen turns them off by writing '0' to
 * localStorage `slate.haptics`.
 */
import { isNativeApp } from './back';

export type HapticPattern = 'tap' | 'select' | 'success' | 'warning' | 'error' | 'longPress';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 6,
  select: 10,
  longPress: 18,
  success: [10, 60, 14],
  warning: [16, 80, 16],
  error: [24, 60, 24, 60, 24],
};

/** How many iOS ticks each pattern plays, spaced out in time. */
const IOS_TICKS: Record<HapticPattern, number> = {
  tap: 1,
  select: 1,
  longPress: 1,
  success: 2,
  warning: 2,
  error: 3,
};

const KEY = 'slate.haptics';

export function hapticsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

let iosLabel: HTMLLabelElement | null = null;

/** A hidden switch whose label, when clicked, makes iOS play its selection tick. */
function iosSwitch(): HTMLLabelElement | null {
  if (iosLabel?.isConnected) return iosLabel;
  if (typeof document === 'undefined' || !document.body) return null;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  iosLabel = label;
  return label;
}

let native: Promise<typeof import('@capacitor/haptics')> | null = null;

/** In the Android app the phone's own haptic engine is used: crisper than a vibration. */
function nativeHaptic(pattern: HapticPattern) {
  native ??= import('@capacitor/haptics');
  void native
    .then(({ Haptics, ImpactStyle, NotificationType }) => {
      if (pattern === 'tap' || pattern === 'select') return Haptics.impact({ style: ImpactStyle.Light });
      if (pattern === 'longPress') return Haptics.impact({ style: ImpactStyle.Medium });
      const type = pattern === 'success' ? NotificationType.Success : pattern === 'warning' ? NotificationType.Warning : NotificationType.Error;
      return Haptics.notification({ type });
    })
    .catch(() => {});
}

export function haptic(pattern: HapticPattern = 'tap'): void {
  if (!hapticsEnabled()) return;
  if (isNativeApp()) {
    nativeHaptic(pattern);
    return;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && !isIOS()) {
      navigator.vibrate(PATTERNS[pattern]);
      return;
    }
    if (isIOS()) {
      const label = iosSwitch();
      if (!label) return;
      const n = IOS_TICKS[pattern];
      for (let i = 0; i < n; i++) {
        if (i === 0) label.click();
        else window.setTimeout(() => label.click(), i * 90);
      }
    }
  } catch {
    // Haptics are a nicety; never let them break an interaction.
  }
}
