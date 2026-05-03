import { describe, test, expect } from 'bun:test';
import {
  PRICING,
  DEFAULT_MODEL,
  parseArgs,
  deriveOutputPath,
  calculateCost,
  formatTranscript,
} from '../lib.js';

describe('parseArgs', () => {
  test('returns defaults for empty args', () => {
    expect(parseArgs([])).toEqual({ speakers: false, filePatterns: [] });
  });

  test('treats a single positional argument as a file pattern', () => {
    expect(parseArgs(['recording.mp3'])).toEqual({
      speakers: false,
      filePatterns: ['recording.mp3'],
    });
  });

  test('collects multiple positional arguments in order', () => {
    expect(parseArgs(['a.mp3', 'b.wav', 'c.m4a'])).toEqual({
      speakers: false,
      filePatterns: ['a.mp3', 'b.wav', 'c.m4a'],
    });
  });

  test('--speakers sets the speakers flag without consuming a positional', () => {
    expect(parseArgs(['--speakers', 'meeting.mp3'])).toEqual({
      speakers: true,
      filePatterns: ['meeting.mp3'],
    });
  });

  test('--speakers can appear in any position', () => {
    expect(parseArgs(['a.mp3', '--speakers', 'b.mp3'])).toEqual({
      speakers: true,
      filePatterns: ['a.mp3', 'b.mp3'],
    });
  });

  test('--speakers with no patterns leaves filePatterns empty', () => {
    expect(parseArgs(['--speakers'])).toEqual({
      speakers: true,
      filePatterns: [],
    });
  });

  test('preserves glob-like patterns verbatim', () => {
    expect(parseArgs(['recordings/*.mp3', 'folder/**/*.wav'])).toEqual({
      speakers: false,
      filePatterns: ['recordings/*.mp3', 'folder/**/*.wav'],
    });
  });

  test('unknown flags are passed through as patterns (current behavior)', () => {
    expect(parseArgs(['--unknown', 'a.mp3'])).toEqual({
      speakers: false,
      filePatterns: ['--unknown', 'a.mp3'],
    });
  });
});

describe('deriveOutputPath', () => {
  test('replaces .mp3 with .txt', () => {
    expect(deriveOutputPath('audio.mp3')).toBe('audio.txt');
  });

  test('replaces .wav with .txt', () => {
    expect(deriveOutputPath('clip.wav')).toBe('clip.txt');
  });

  test('replaces .m4a with .txt', () => {
    expect(deriveOutputPath('voice.m4a')).toBe('voice.txt');
  });

  test('preserves directory paths', () => {
    expect(deriveOutputPath('/abs/path/to/file.mp3')).toBe('/abs/path/to/file.txt');
  });

  test('handles relative paths with ./', () => {
    expect(deriveOutputPath('./recordings/a.mp3')).toBe('./recordings/a.txt');
  });

  test('only replaces the final extension when filename has multiple dots', () => {
    expect(deriveOutputPath('episode.1.intro.mp3')).toBe('episode.1.intro.txt');
  });

  test('appends .txt for filenames without an extension', () => {
    expect(deriveOutputPath('noext')).toBe('noext.txt');
  });

  test('does not strip extensions buried inside directory names', () => {
    expect(deriveOutputPath('./backup.old/file.mp3')).toBe('./backup.old/file.txt');
  });
});

describe('calculateCost', () => {
  test('returns the unknown model and default pricing when modelInfo is missing', () => {
    const result = calculateCost(60, null);
    expect(result.model).toBe('unknown');
    expect(result.pricePerMinute).toBe(PRICING[DEFAULT_MODEL]);
    expect(result.durationInMinutes).toBe(1);
    expect(result.estimatedCost).toBeCloseTo(PRICING[DEFAULT_MODEL]);
  });

  test('returns the unknown model when modelInfo is undefined', () => {
    const result = calculateCost(120, undefined);
    expect(result.model).toBe('unknown');
    expect(result.pricePerMinute).toBe(PRICING[DEFAULT_MODEL]);
  });

  test('returns the unknown model when modelInfo is an empty object', () => {
    const result = calculateCost(60, {});
    expect(result.model).toBe('unknown');
    expect(result.pricePerMinute).toBe(PRICING[DEFAULT_MODEL]);
  });

  test('extracts nova-3 from "general-nova-3" arch', () => {
    const modelInfo = {
      'abc-123': { arch: 'general-nova-3', name: 'general' },
    };
    const result = calculateCost(60, modelInfo);
    expect(result.model).toBe('nova-3');
    expect(result.pricePerMinute).toBe(PRICING['nova-3']);
  });

  test('extracts nova-2 from "general-nova-2" arch', () => {
    const modelInfo = {
      'abc-123': { arch: 'general-nova-2' },
    };
    const result = calculateCost(60, modelInfo);
    expect(result.model).toBe('nova-2');
    expect(result.pricePerMinute).toBe(PRICING['nova-2']);
  });

  test('falls back to name when arch is missing', () => {
    const modelInfo = {
      'abc-123': { name: 'enhanced' },
    };
    const result = calculateCost(60, modelInfo);
    expect(result.model).toBe('enhanced');
    expect(result.pricePerMinute).toBe(PRICING['enhanced']);
  });

  test('prefers arch over name when both are present', () => {
    const modelInfo = {
      'abc-123': { arch: 'general-nova-3', name: 'enhanced' },
    };
    const result = calculateCost(60, modelInfo);
    expect(result.model).toBe('nova-3');
    expect(result.pricePerMinute).toBe(PRICING['nova-3']);
  });

  test('uses default pricing for an unrecognized model name', () => {
    const modelInfo = {
      'abc-123': { name: 'mystery-model' },
    };
    const result = calculateCost(60, modelInfo);
    expect(result.model).toBe('mystery-model');
    expect(result.pricePerMinute).toBe(PRICING[DEFAULT_MODEL]);
  });

  test('matches whisper directly', () => {
    const modelInfo = {
      'abc-123': { name: 'whisper' },
    };
    const result = calculateCost(60, modelInfo);
    expect(result.model).toBe('whisper');
    expect(result.pricePerMinute).toBe(PRICING['whisper']);
  });

  test('reads from the first key when modelInfo has multiple', () => {
    const modelInfo = {
      first: { arch: 'general-nova-3' },
      second: { arch: 'general-nova-2' },
    };
    const result = calculateCost(60, modelInfo);
    expect(result.model).toBe('nova-3');
  });

  test('computes duration in minutes correctly', () => {
    const modelInfo = { x: { arch: 'general-nova-3' } };
    expect(calculateCost(0, modelInfo).durationInMinutes).toBe(0);
    expect(calculateCost(30, modelInfo).durationInMinutes).toBe(0.5);
    expect(calculateCost(60, modelInfo).durationInMinutes).toBe(1);
    expect(calculateCost(150, modelInfo).durationInMinutes).toBe(2.5);
  });

  test('estimatedCost is duration in minutes times price per minute', () => {
    const modelInfo = { x: { arch: 'general-nova-2' } };
    const result = calculateCost(120, modelInfo);
    expect(result.estimatedCost).toBeCloseTo(2 * PRICING['nova-2']);
  });

  test('estimatedCost is zero for zero duration', () => {
    const result = calculateCost(0, { x: { arch: 'general-nova-3' } });
    expect(result.estimatedCost).toBe(0);
  });

  test('handles missing inner model object gracefully', () => {
    const result = calculateCost(60, { 'abc-123': null });
    expect(result.model).toBe('unknown');
    expect(result.pricePerMinute).toBe(PRICING[DEFAULT_MODEL]);
  });
});

describe('formatTranscript', () => {
  test('returns the raw transcript when no paragraphs and no speakers', () => {
    const out = formatTranscript({ transcript: 'hello world' });
    expect(out).toBe('hello world');
  });

  test('returns empty string when nothing is available', () => {
    expect(formatTranscript({})).toBe('');
  });

  test('joins paragraphs with double newlines when no speakers', () => {
    const paragraphs = [
      { start: 0, sentences: [{ text: 'First sentence.' }, { text: 'Second sentence.' }] },
      { start: 5, sentences: [{ text: 'Third sentence.' }] },
    ];
    const out = formatTranscript({ transcript: 'ignored', paragraphs });
    expect(out).toBe('First sentence. Second sentence.\n\nThird sentence.');
  });

  test('falls back to plain transcript when speakers requested but no words present', () => {
    const out = formatTranscript({
      transcript: 'fallback transcript',
      speakers: true,
      words: [],
    });
    expect(out).toBe('fallback transcript');
  });

  test('falls back to paragraph formatting when speakers requested but no words', () => {
    const paragraphs = [
      { start: 0, sentences: [{ text: 'A.' }] },
      { start: 1, sentences: [{ text: 'B.' }] },
    ];
    const out = formatTranscript({
      transcript: 'plain',
      paragraphs,
      words: [],
      speakers: true,
    });
    expect(out).toBe('A.\n\nB.');
  });

  test('labels each paragraph by speaker found at its start time', () => {
    const paragraphs = [
      { start: 0.0, sentences: [{ text: 'Hi there.' }] },
      { start: 5.0, sentences: [{ text: 'Hello back.' }] },
    ];
    const words = [
      { word: 'Hi', start: 0.0, speaker: 0 },
      { word: 'there', start: 0.5, speaker: 0 },
      { word: 'Hello', start: 5.0, speaker: 1 },
      { word: 'back', start: 5.5, speaker: 1 },
    ];
    const out = formatTranscript({ paragraphs, words, speakers: true });
    expect(out).toBe('Speaker 0: Hi there.\n\nSpeaker 1: Hello back.');
  });

  test('matches words within a 0.1s tolerance of the paragraph start', () => {
    const paragraphs = [{ start: 1.0, sentences: [{ text: 'Hey.' }] }];
    const words = [
      { word: 'Hey', start: 1.05, speaker: 2 },
    ];
    const out = formatTranscript({ paragraphs, words, speakers: true });
    expect(out).toBe('Speaker 2: Hey.');
  });

  test('defaults to speaker 0 when no word is within tolerance of the paragraph start', () => {
    const paragraphs = [{ start: 10.0, sentences: [{ text: 'Lonely.' }] }];
    const words = [{ word: 'elsewhere', start: 50.0, speaker: 1 }];
    const out = formatTranscript({ paragraphs, words, speakers: true });
    expect(out).toBe('Speaker 0: Lonely.');
  });

  test('joins multi-sentence paragraphs into one labeled line', () => {
    const paragraphs = [
      {
        start: 0,
        sentences: [{ text: 'One.' }, { text: 'Two.' }, { text: 'Three.' }],
      },
    ];
    const words = [{ word: 'One', start: 0, speaker: 3 }];
    const out = formatTranscript({ paragraphs, words, speakers: true });
    expect(out).toBe('Speaker 3: One. Two. Three.');
  });

  test('groups consecutive same-speaker words when no paragraphs', () => {
    const words = [
      { word: 'Hello', start: 0, speaker: 0 },
      { word: 'world', start: 0.5, speaker: 0 },
      { word: 'goodbye', start: 1.0, speaker: 1 },
      { word: 'now', start: 1.5, speaker: 1 },
    ];
    const out = formatTranscript({ words, speakers: true });
    expect(out).toBe('Speaker 0: Hello world\n\nSpeaker 1: goodbye now');
  });

  test('alternating speakers produce alternating segments', () => {
    const words = [
      { word: 'A', start: 0, speaker: 0 },
      { word: 'B', start: 1, speaker: 1 },
      { word: 'C', start: 2, speaker: 0 },
      { word: 'D', start: 3, speaker: 1 },
    ];
    const out = formatTranscript({ words, speakers: true });
    expect(out).toBe('Speaker 0: A\n\nSpeaker 1: B\n\nSpeaker 0: C\n\nSpeaker 1: D');
  });

  test('single-word transcript with speakers produces one labeled segment', () => {
    const words = [{ word: 'Hi', start: 0, speaker: 4 }];
    const out = formatTranscript({ words, speakers: true });
    expect(out).toBe('Speaker 4: Hi');
  });

  test('ignores paragraph and word data when speakers flag is false', () => {
    const paragraphs = [{ start: 0, sentences: [{ text: 'P.' }] }];
    const words = [{ word: 'P', start: 0, speaker: 9 }];
    const out = formatTranscript({
      transcript: 'raw',
      paragraphs,
      words,
      speakers: false,
    });
    expect(out).toBe('P.');
  });
});

describe('PRICING', () => {
  test('contains entries for all advertised models', () => {
    expect(PRICING).toHaveProperty('nova-2');
    expect(PRICING).toHaveProperty('nova-3');
    expect(PRICING).toHaveProperty('enhanced');
    expect(PRICING).toHaveProperty('whisper');
    expect(PRICING).toHaveProperty('nova-2-whisper');
    expect(PRICING).toHaveProperty('nova-3-whisper');
  });

  test('all entries are positive numbers', () => {
    for (const [model, price] of Object.entries(PRICING)) {
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);
    }
  });

  test('default model is registered in PRICING', () => {
    expect(PRICING).toHaveProperty(DEFAULT_MODEL);
  });
});
