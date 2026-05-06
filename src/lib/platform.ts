export type Platform = 'mac' | 'windows' | 'linux' | 'unknown';

let _platform: Platform | null = null;

export function detectPlatform(): Platform {
  if (_platform) return _platform;

  if (typeof navigator === 'undefined') {
    _platform = 'unknown';
    return _platform;
  }

  const ua = navigator.userAgent;

  if (ua.includes('Win')) {
    _platform = 'windows';
  } else if (ua.includes('Mac')) {
    _platform = 'mac';
  } else if (ua.includes('Linux')) {
    _platform = 'linux';
  } else {
    _platform = 'unknown';
  }

  return _platform;
}

export function isMac(): boolean {
  return detectPlatform() === 'mac';
}

export function isWindows(): boolean {
  return detectPlatform() === 'windows';
}
