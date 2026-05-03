// Deepgram pricing information (as of March 2025)
export const PRICING = {
  // Standard models
  'nova-2': 0.0043,
  'nova-2-whisper': 0.0059,
  'enhanced': 0.015,
  'whisper': 0.0209,

  // Premium models
  'nova-3': 0.0069,
  'nova-3-whisper': 0.0097,
};

export const DEFAULT_MODEL = 'nova-3';

const KNOWN_FLAGS = new Set(['--speakers']);

export function parseArgs(args) {
  const options = { speakers: false, filePatterns: [] };

  for (const arg of args) {
    if (arg === '--speakers') {
      options.speakers = true;
    } else {
      options.filePatterns.push(arg);
    }
  }

  return options;
}

export function deriveOutputPath(inputFilePath) {
  return `${inputFilePath.replace(/\.[^/.]+$/, '')}.txt`;
}

export function calculateCost(durationInSeconds, modelInfo) {
  let modelName = null;

  if (modelInfo) {
    const modelKey = Object.keys(modelInfo)[0];
    if (modelKey && modelInfo[modelKey]) {
      const modelData = modelInfo[modelKey];
      modelName = modelData.arch || modelData.name;

      if (modelName && modelName.includes('nova')) {
        if (modelName.includes('nova-2')) modelName = 'nova-2';
        else if (modelName.includes('nova-3')) modelName = 'nova-3';
      }
    }
  }

  const pricePerMinute = modelName && PRICING[modelName]
    ? PRICING[modelName]
    : PRICING[DEFAULT_MODEL];

  const durationInMinutes = durationInSeconds / 60;
  const estimatedCost = durationInMinutes * pricePerMinute;

  return {
    model: modelName || 'unknown',
    pricePerMinute,
    durationInMinutes,
    estimatedCost,
  };
}

function findSpeakerForParagraph(paragraph, words) {
  for (const word of words) {
    if (Math.abs(word.start - paragraph.start) < 0.1) {
      return word.speaker;
    }
  }
  return 0;
}

function groupWordsBySpeaker(words) {
  const segments = [];
  let currentSpeaker = null;
  let currentText = '';

  for (const word of words) {
    if (currentSpeaker !== word.speaker) {
      if (currentText) {
        segments.push({ speaker: currentSpeaker, text: currentText.trim() });
      }
      currentSpeaker = word.speaker;
      currentText = word.word;
    } else {
      currentText += ' ' + word.word;
    }
  }

  if (currentText) {
    segments.push({ speaker: currentSpeaker, text: currentText.trim() });
  }

  return segments;
}

function paragraphText(paragraph) {
  return paragraph.sentences.map((s) => s.text).join(' ');
}

export function formatTranscript({
  transcript = '',
  paragraphs = [],
  words = [],
  speakers = false,
}) {
  if (speakers && words.length > 0) {
    if (paragraphs.length > 0) {
      return paragraphs
        .map((p) => `Speaker ${findSpeakerForParagraph(p, words)}: ${paragraphText(p)}`)
        .join('\n\n');
    }

    return groupWordsBySpeaker(words)
      .map((s) => `Speaker ${s.speaker}: ${s.text}`)
      .join('\n\n');
  }

  if (paragraphs.length > 0) {
    return paragraphs.map(paragraphText).join('\n\n');
  }

  return transcript;
}
