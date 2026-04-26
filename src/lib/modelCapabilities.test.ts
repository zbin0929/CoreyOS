import { describe, expect, it } from 'vitest';

import { visionSupport } from './modelCapabilities';

describe('visionSupport', () => {
  it('returns "unknown" for null / empty / whitespace input', () => {
    expect(visionSupport(null)).toBe('unknown');
    expect(visionSupport(undefined)).toBe('unknown');
    expect(visionSupport('')).toBe('unknown');
    expect(visionSupport('   ')).toBe('unknown');
  });

  it('matches well-known vision-capable models on the allow list', () => {
    for (const id of [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-5-turbo',
      'gpt-4-vision-preview',
      'claude-3-5-sonnet',
      'claude-sonnet-4',
      'claude-opus-4',
      'gemini-1.5-pro',
      'qwen-vl-max',
      'qwen2-vl-7b',
      'llava-13b',
      'minicpm-v-2_6',
      'internvl-chat',
      'pixtral-12b',
    ]) {
      expect(visionSupport(id), id).toBe('yes');
    }
  });

  it('flags well-known text-only models on the deny list', () => {
    for (const id of [
      'deepseek-reasoner',
      'deepseek-chat',
      'deepseek-coder',
      'gpt-3.5-turbo',
      'text-embedding-3-small',
      'mistral-7b-instruct',
    ]) {
      expect(visionSupport(id), id).toBe('no');
    }
  });

  it('returns "unknown" for never-heard-of models so the UI stays permissive', () => {
    expect(visionSupport('totally-new-model-2030')).toBe('unknown');
    expect(visionSupport('local-finetune-xyz')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(visionSupport('GPT-4O')).toBe('yes');
    expect(visionSupport('Claude-3-Opus')).toBe('yes');
    expect(visionSupport('DEEPSEEK-REASONER')).toBe('no');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(visionSupport('  gpt-4o  ')).toBe('yes');
  });
});
