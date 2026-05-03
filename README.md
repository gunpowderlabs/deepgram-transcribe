# Deepgram Transcription CLI

A command-line tool for batch transcribing audio files using the Deepgram API.

## Features

- Transcribe individual files or batches using glob patterns
- Smart formatting with paragraph segmentation
- Speaker recognition with the `--speakers` flag
- Progress tracking and detailed logs
- Cost estimation based on Deepgram's pricing
- Summary statistics and file breakdown after processing
- Skip previously transcribed files automatically

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/transcribe.git
   cd transcribe
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your Deepgram API key:
   ```
   DEEPGRAM_API_KEY=your_api_key_here
   ```

4. Optionally, install globally:
   ```bash
   npm install -g .
   ```

## Usage

### Basic Usage

Transcribe a single file:
```bash
node transcribe.js path/to/audio.mp3
```

Transcribe using glob patterns:
```bash
node transcribe.js "recordings/*.mp3"
```

Transcribe multiple patterns:
```bash
node transcribe.js "folder1/*.mp3" "folder2/*.wav"
```

### Speaker Recognition

Enable speaker recognition (diarization) to identify different speakers in the audio:
```bash
node transcribe.js --speakers "recordings/meeting.mp3"
```

This will format the transcript with "Speaker 0:", "Speaker 1:", etc. prefixes.

### If Installed Globally

```bash
transcribe "*.mp3"
```

## Output

- Transcript files are saved with the same name as the input file plus `.txt` extension
- Log files are stored in the `logs/` directory with timestamps
- Console output provides real-time status and summary statistics

## Pricing

The tool calculates estimated costs based on Deepgram's pricing (as of March 2025):

| Model | Price per Minute |
|-------|------------------|
| nova-2 | $0.0043 |
| nova-3 | $0.0069 |
| enhanced | $0.015 |
| whisper | $0.0209 |

## Environment Variables

- `DEEPGRAM_API_KEY`: Your Deepgram API key (required)
- `DEBUG_LOGS`: Set to 'true' to enable detailed metadata logging (optional)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.