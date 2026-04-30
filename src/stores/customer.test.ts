import { describe, it, expect } from 'vitest';
import {
  hexToHslTriplet,
  selectBrandAppName,
  selectBrandLogoUrl,
  selectHiddenRoutes,
  type CustomerConfig,
} from './customer';

function makeConfig(overrides: Partial<CustomerConfig> = {}): CustomerConfig {
  return {
    schemaVersion: 1,
    brand: { appName: '', logo: '', primaryColor: '' },
    navigation: { hiddenRoutes: [] },
    present: true,
    error: null,
    ...overrides,
  };
}

describe('hexToHslTriplet', () => {
  it('converts 6-digit hex to HSL triplet', () => {
    // #FF6B00 ≈ orange. Expected: H≈25, S=100%, L=50%.
    expect(hexToHslTriplet('#FF6B00')).toBe('25 100% 50%');
  });

  it('accepts hex without leading #', () => {
    expect(hexToHslTriplet('00FF00')).toBe('120 100% 50%');
  });

  it('accepts 3-digit shorthand', () => {
    // #F00 -> #FF0000 -> red.
    expect(hexToHslTriplet('#F00')).toBe('0 100% 50%');
  });

  it('returns null for malformed input', () => {
    expect(hexToHslTriplet('not-a-color')).toBeNull();
    expect(hexToHslTriplet('#ZZZ')).toBeNull();
    expect(hexToHslTriplet('#1234567')).toBeNull();
  });

  it('produces a string the design tokens can consume', () => {
    const hsl = hexToHslTriplet('#000000');
    // Black: any hue, sat 0, lightness 0.
    expect(hsl).toMatch(/^\d+ 0% 0%$/);
  });
});

describe('selectHiddenRoutes', () => {
  it('returns an empty set when no config is loaded', () => {
    expect(selectHiddenRoutes(null).size).toBe(0);
  });

  it('returns an empty set when config is present but unmarked', () => {
    expect(
      selectHiddenRoutes(makeConfig({ present: false })).size,
    ).toBe(0);
  });

  it('returns the configured ids when present', () => {
    const set = selectHiddenRoutes(
      makeConfig({
        navigation: { hiddenRoutes: ['analytics', 'browser'] },
      }),
    );
    expect(set.has('analytics')).toBe(true);
    expect(set.has('browser')).toBe(true);
    expect(set.has('chat')).toBe(false);
  });
});

describe('selectBrandAppName', () => {
  it('falls back when config is null', () => {
    expect(selectBrandAppName(null, 'Corey')).toBe('Corey');
  });

  it('uses the override when set', () => {
    expect(
      selectBrandAppName(
        makeConfig({
          brand: { appName: 'ACME', logo: '', primaryColor: '' },
        }),
        'Corey',
      ),
    ).toBe('ACME');
  });

  it('falls back when override is blank/whitespace', () => {
    expect(
      selectBrandAppName(
        makeConfig({
          brand: { appName: '   ', logo: '', primaryColor: '' },
        }),
        'Corey',
      ),
    ).toBe('Corey');
  });
});

describe('selectBrandLogoUrl', () => {
  it('returns empty string when no config is loaded', () => {
    expect(selectBrandLogoUrl(null)).toBe('');
  });

  it('returns the configured logo path when present', () => {
    expect(
      selectBrandLogoUrl(
        makeConfig({
          brand: { appName: '', logo: '/abs/logo.png', primaryColor: '' },
        }),
      ),
    ).toBe('/abs/logo.png');
  });
});
