#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require("@deepgram/sdk");
const fs = require("fs");
const path = require("path");
const glob = require("glob");
const util = require('util');

// Create logs directory if it doesn't exist
const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR);
}

// Set up log file
const LOG_FILE = path.join(LOGS_DIR, `deepgram-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

// Create a write stream to the log file
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// Custom logger that writes to both console and file with timestamps
const logger = {
  log: function(...args) {
    const timestamp = new Date().toISOString();
    const message = util.format(...args);
    const logMessage = `[${timestamp}] ${message}`;
    
    // Write to console
    console.log(message);
    
    // Write to file
    logStream.write(logMessage + '\n');
  },
  
  error: function(...args) {
    const timestamp = new Date().toISOString();
    const message = util.format(...args);
    const logMessage = `[${timestamp}] ERROR: ${message}`;
    
    // Write to console
    console.error(message);
    
    // Write to file
    logStream.write(logMessage + '\n');
  }
};

const transcribeFile = async (inputFilePath) => {
  logger.log(`Processing: ${inputFilePath}`);
  
  // STEP 1: Create a Deepgram client using the API key
  const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

  try {
    // STEP 2: Call the transcribeFile method with the audio payload and options
    logger.log(`Reading file and sending to Deepgram API...`);
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      // path to the audio file
      fs.readFileSync(inputFilePath),
      // STEP 3: Configure Deepgram options for audio analysis
      {
        model: "nova-3",
        smart_format: true,
      }
    );

    if (error) throw error;

    // STEP 4: Extract the transcript
    const transcript = result.results.channels[0].alternatives[0].transcript;
    
    // Get paragraphs if available
    const paragraphs = result.results.channels[0].alternatives[0].paragraphs?.paragraphs || [];
    const paragraphText = paragraphs.length > 0 
      ? paragraphs.map(p => {
          // Join all sentences in the paragraph
          const sentences = p.sentences.map(s => s.text).join(' ');
          return sentences;
        }).join('\n\n')
      : transcript;

    // Log metadata about the transcription
    logger.log(`Transcription complete for ${inputFilePath}`);
    logger.log(`Duration: ${result.metadata.duration} seconds`);
    
    // STEP 5: Print the transcript to console
    logger.log("\nTranscript:");
    logger.log(paragraphText);
    
    // STEP 6: Write the transcript to a file
    const outputPath = `${inputFilePath}.txt`;
    fs.writeFileSync(outputPath, paragraphText);
    logger.log(`\nTranscript saved to: ${outputPath}`);
    
    return true;
  } catch (err) {
    logger.error(`Error during transcription of ${inputFilePath}:`, err);
    return false;
  }
};

// Main function to process files
const processFiles = async () => {
  // Log startup info
  logger.log(`Deepgram Transcription Started`);
  logger.log(`Logging to file: ${LOG_FILE}`);
  
  // Get input patterns from command line arguments
  const filePatterns = process.argv.slice(2);
  
  if (filePatterns.length === 0) {
    logger.error("Please provide at least one file path or pattern as an argument");
    process.exit(1);
  }

  logger.log(`Processing patterns: ${filePatterns.join(', ')}`);

  // Expand all glob patterns into file paths
  let filesToProcess = [];
  
  for (const pattern of filePatterns) {
    // If it's a direct file path that exists, add it
    if (fs.existsSync(pattern) && fs.statSync(pattern).isFile()) {
      filesToProcess.push(pattern);
    } 
    // Otherwise treat it as a glob pattern
    else {
      const matches = glob.sync(pattern);
      logger.log(`Pattern '${pattern}' matched ${matches.length} files`);
      filesToProcess = filesToProcess.concat(matches);
    }
  }
  
  if (filesToProcess.length === 0) {
    logger.error("No matching files found for the provided patterns");
    process.exit(1);
  }
  
  logger.log(`Found ${filesToProcess.length} files to process`);
  
  // Process each file
  let successCount = 0;
  const startTime = Date.now();
  
  for (const file of filesToProcess) {
    const success = await transcribeFile(file);
    if (success) successCount++;
  }
  
  const duration = (Date.now() - startTime) / 1000;
  logger.log(`\nCompleted processing ${successCount} of ${filesToProcess.length} files in ${duration.toFixed(2)} seconds`);
  
  // Close the log stream
  logStream.end();
};

// Create .gitignore if it doesn't exist
const GITIGNORE_PATH = path.join(__dirname, '.gitignore');
if (!fs.existsSync(GITIGNORE_PATH)) {
  fs.writeFileSync(GITIGNORE_PATH, 'node_modules/\n.env\nlogs/\n');
  console.log('Created .gitignore file');
} else {
  // Append logs/ to .gitignore if not already present
  const gitignoreContent = fs.readFileSync(GITIGNORE_PATH, 'utf8');
  if (!gitignoreContent.includes('logs/')) {
    fs.appendFileSync(GITIGNORE_PATH, 'logs/\n');
    console.log('Added logs/ to .gitignore file');
  }
}

// Handle process termination to ensure logs are written
process.on('exit', () => {
  logStream.end();
});

// Run the main function
processFiles();

