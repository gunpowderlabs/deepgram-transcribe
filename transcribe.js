#!/usr/bin/env node

// Suppress the punycode deprecation warning
process.emitWarning = (warning, ...args) => {
  if (typeof warning === 'string' && warning.includes('punycode')) {
    return;
  }
  return process._originalEmitWarning(warning, ...args);
};
process._originalEmitWarning = process.emitWarning;

import 'dotenv/config';
import { createClient } from '@deepgram/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import util from 'util';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import cliProgress from 'cli-progress';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Deepgram pricing information (as of March 2025)
// You may need to update these prices if they change
const PRICING = {
  // Standard models
  'nova-2': 0.0043, // per minute
  'nova-2-whisper': 0.0059, // per minute
  'enhanced': 0.015, // per minute
  'whisper': 0.0209, // per minute
  
  // Premium models
  'nova-3': 0.0069, // per minute
  'nova-3-whisper': 0.0097, // per minute
};

// Create logs directory if it doesn't exist
const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR);
}

// Set up log file
const LOG_FILE = path.join(LOGS_DIR, `deepgram-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

// Create a write stream to the log file
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// CLI spinner for showing progress
const spinner = ora({
  text: 'Starting transcription...',
  color: 'blue',
  spinner: 'dots'
});

// Progress bar for batch processing
const multibar = new cliProgress.MultiBar({
  clearOnComplete: false,
  hideCursor: true,
  format: ' {bar} | {filename} | {percentage}% | {value}/{total} seconds'
}, cliProgress.Presets.shades_grey);

// Status object for the CLI
const cliStatus = {
  isProcessing: false,
  currentFile: null,
  progressBar: null,
  filesProcessed: 0,
  totalFiles: 0,
  totalCost: 0,
  fileResults: []
};

// Enhanced logger that writes to both console and file with timestamps and colors
const logger = {
  // File logging only
  fileLog: function(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    logStream.write(logMessage + '\n');
  },
  
  // Both console and file
  log: function(...args) {
    const timestamp = new Date().toISOString();
    const message = util.format(...args);
    const logMessage = `[${timestamp}] ${message}`;
    
    // If we're currently processing a file, use the spinner
    if (cliStatus.isProcessing) {
      spinner.text = message;
    } else {
      console.log(chalk.blue(message));
    }
    
    // Write to file
    logStream.write(logMessage + '\n');
  },
  
  // Success message (green)
  success: function(...args) {
    const timestamp = new Date().toISOString();
    const message = util.format(...args);
    const logMessage = `[${timestamp}] SUCCESS: ${message}`;
    
    if (!cliStatus.isProcessing) {
      console.log(chalk.green(message));
    }
    
    // Write to file
    logStream.write(logMessage + '\n');
  },
  
  // Information message (cyan)
  info: function(...args) {
    const timestamp = new Date().toISOString();
    const message = util.format(...args);
    const logMessage = `[${timestamp}] INFO: ${message}`;
    
    if (!cliStatus.isProcessing) {
      console.log(chalk.cyan(message));
    }
    
    // Write to file
    logStream.write(logMessage + '\n');
  },
  
  // Warning message (yellow)
  warn: function(...args) {
    const timestamp = new Date().toISOString();
    const message = util.format(...args);
    const logMessage = `[${timestamp}] WARNING: ${message}`;
    
    // Always show warnings
    spinner.stop();
    console.log(chalk.yellow('⚠️  ' + message));
    if (cliStatus.isProcessing) {
      spinner.start();
    }
    
    // Write to file
    logStream.write(logMessage + '\n');
  },
  
  // Error message (red)
  error: function(...args) {
    const timestamp = new Date().toISOString();
    const message = util.format(...args);
    const logMessage = `[${timestamp}] ERROR: ${message}`;
    
    // Always show errors
    spinner.stop();
    console.error(chalk.red('❌ ' + message));
    if (cliStatus.isProcessing) {
      spinner.start();
    }
    
    // Write to file
    logStream.write(logMessage + '\n');
  }
};

// Helper function to calculate cost
const calculateCost = (durationInSeconds, modelInfo) => {
  // Extract the model name from the metadata
  let modelName = null;
  
  // Try to find the model name from the metadata
  if (modelInfo) {
    // Get the first model key
    const modelKey = Object.keys(modelInfo)[0];
    if (modelKey && modelInfo[modelKey]) {
      // Extract the model name from arch or name property
      const modelData = modelInfo[modelKey];
      modelName = modelData.arch || modelData.name;
      
      // For models like "general-nova-3", extract just "nova-3"
      if (modelName && modelName.includes('nova')) {
        if (modelName.includes('nova-2')) modelName = 'nova-2';
        else if (modelName.includes('nova-3')) modelName = 'nova-3';
      }
    }
  }
  
  // Get the price per minute for the model
  const pricePerMinute = modelName && PRICING[modelName] 
    ? PRICING[modelName] 
    : PRICING['nova-3']; // Default to nova-3 if model not found
  
  // Convert seconds to minutes
  const durationInMinutes = durationInSeconds / 60;
  
  // Calculate the cost
  const cost = durationInMinutes * pricePerMinute;
  
  return {
    model: modelName || 'unknown',
    pricePerMinute,
    durationInMinutes,
    estimatedCost: cost
  };
};

const transcribeFile = async (inputFilePath, options = {}) => {
  // Set status for UI updates
  cliStatus.isProcessing = true;
  cliStatus.currentFile = path.basename(inputFilePath);
  
  // Check if transcript already exists
  // Create output path by replacing the original extension with .txt
  const outputPath = `${inputFilePath.replace(/\.[^/.]+$/, '')}.txt`;
  if (fs.existsSync(outputPath)) {
    // Skip file if transcript already exists
    spinner.info(chalk.cyan(`Skipped: ${cliStatus.currentFile} (transcript already exists)`));
    logger.fileLog(`Skipped transcription of ${inputFilePath} - transcript already exists at ${outputPath}`);
    cliStatus.isProcessing = false;
    cliStatus.filesProcessed++;
    
    // Try to get the file stats to add to the summary if available
    try {
      const fileStats = fs.statSync(inputFilePath);
      const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
      const transcriptContent = fs.readFileSync(outputPath, 'utf8');
      
      // Add to results with estimated values
      cliStatus.fileResults.push({
        file: inputFilePath,
        filename: path.basename(inputFilePath),
        cost: 0, // No cost since we're skipping
        duration: 0, // We don't know without processing
        model: 'skipped',
        fileSize: fileSizeMB,
        charactersGenerated: transcriptContent.length,
        skipped: true
      });
    } catch (err) {
      logger.fileLog(`Error getting file stats for skipped file ${inputFilePath}: ${err.message}`);
    }
    
    return true;
  }
  
  // Start the spinner
  spinner.text = `Processing: ${cliStatus.currentFile}`;
  spinner.start();
  
  // Log to file only
  logger.fileLog(`Processing: ${inputFilePath}`);
  
  // STEP 1: Create a Deepgram client using the API key
  const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

  try {
    // Read the file and get its stats
    spinner.text = `Reading file: ${cliStatus.currentFile}`;
    const fileBuffer = fs.readFileSync(inputFilePath);
    const fileStats = fs.statSync(inputFilePath);
    const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
    
    // Update spinner with file size info
    spinner.text = `Sending ${fileSizeMB} MB to Deepgram API: ${cliStatus.currentFile}`;
    
    // Configure the Deepgram options
    const deepgramOptions = {
      model: "nova-3",
      smart_format: true,
    };
    
    // Add speaker diarization if requested
    if (options.speakers) {
      deepgramOptions.diarize = true;
      spinner.text = `Sending ${fileSizeMB} MB to Deepgram API with speaker recognition: ${cliStatus.currentFile}`;
    }
    
    // STEP 2: Call the transcribeFile method with the audio payload and options
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      fileBuffer,
      deepgramOptions
    );

    if (error) throw error;

    // STEP 4: Extract the transcript
    const transcript = result.results.channels[0].alternatives[0].transcript;
    
    // Get paragraphs if available
    const paragraphs = result.results.channels[0].alternatives[0].paragraphs?.paragraphs || [];
    
    // Format the transcript based on whether speaker recognition is enabled
    let formattedText;
    
    if (options.speakers && result.results.channels[0].alternatives[0].words) {
      // Get words with speaker information
      const words = result.results.channels[0].alternatives[0].words;
      
      // Group words by speaker
      const speakerSegments = [];
      let currentSpeaker = null;
      let currentText = '';
      
      for (const word of words) {
        // If this is a new speaker or first word
        if (currentSpeaker !== word.speaker) {
          // Add the previous segment if it exists
          if (currentText) {
            speakerSegments.push({ speaker: currentSpeaker, text: currentText.trim() });
          }
          // Start a new segment
          currentSpeaker = word.speaker;
          currentText = word.word;
        } else {
          // Continue current segment
          currentText += ' ' + word.word;
        }
      }
      
      // Add the last segment
      if (currentText) {
        speakerSegments.push({ speaker: currentSpeaker, text: currentText.trim() });
      }
      
      // Format the speaker segments
      formattedText = speakerSegments.map(segment => 
        `Speaker ${segment.speaker}: ${segment.text}`
      ).join('\n\n');
    } else {
      // Use paragraph formatting if available, or plain transcript if not
      formattedText = paragraphs.length > 0 
        ? paragraphs.map(p => {
            // Join all sentences in the paragraph
            const sentences = p.sentences.map(s => s.text).join(' ');
            return sentences;
          }).join('\n\n')
        : transcript;
    }

    // Calculate the cost
    const costInfo = calculateCost(result.metadata.duration, result.metadata.model_info);
    
    // Store result in CLI status for batch summary
    cliStatus.fileResults.push({
      file: inputFilePath,
      filename: path.basename(inputFilePath),
      cost: costInfo.estimatedCost,
      duration: result.metadata.duration,
      model: costInfo.model,
      fileSize: fileSizeMB,
      charactersGenerated: formattedText.length,
      speakers: options.speakers
    });
    cliStatus.totalCost += costInfo.estimatedCost;
    cliStatus.filesProcessed++;
    
    // STEP 5: Write the transcript to a file without printing it
    fs.writeFileSync(outputPath, formattedText);
    
    // Create a success message that indicates if speaker recognition was used
    const speakerInfo = options.speakers ? ' with speaker recognition' : '';
    
    // Update spinner with success message
    spinner.succeed(chalk.green(`Processed${speakerInfo}: ${cliStatus.currentFile} (${(result.metadata.duration / 60).toFixed(2)} min, $${costInfo.estimatedCost.toFixed(4)})`));
    cliStatus.isProcessing = false;
    
    // Log detailed info to file
    logger.fileLog(`Transcription complete for ${inputFilePath}`);
    logger.fileLog(`Duration: ${result.metadata.duration.toFixed(2)} seconds (${(result.metadata.duration / 60).toFixed(2)} minutes)`);
    logger.fileLog(`Model: ${costInfo.model}`);
    logger.fileLog(`Speaker Recognition: ${options.speakers ? 'Enabled' : 'Disabled'}`);
    logger.fileLog(`Cost: $${costInfo.estimatedCost.toFixed(4)} ($${costInfo.pricePerMinute.toFixed(4)}/minute)`);
    logger.fileLog(`File size: ${fileSizeMB} MB`);
    logger.fileLog(`Transcript saved to: ${outputPath} (${formattedText.length} characters)`);
    
    // Include full metadata in debug logs
    if (process.env.DEBUG_LOGS === 'true') {
      logger.fileLog(`Full Metadata: ${JSON.stringify({
        duration: result.metadata.duration,
        channels: result.metadata.channels,
        model: result.metadata.model_info,
        request_id: result.metadata.request_id,
        diarize: options.speakers
      }, null, 2)}`);
    }
    
    return true;
  } catch (err) {
    spinner.fail(chalk.red(`Failed: ${cliStatus.currentFile}`));
    logger.error(`Error during transcription of ${inputFilePath}:`, err);
    cliStatus.isProcessing = false;
    return false;
  }
};

// Main function to process files
const processFiles = async () => {
  // Clear the screen for a clean UI
  process.stdout.write('\x1Bc');
  
  // Display a fancy header
  console.log(chalk.bold.blue('\n📝 DEEPGRAM TRANSCRIPTION CLI 📝'));
  console.log(chalk.blue('─'.repeat(50)));
  
  // Log startup info
  logger.info(`Deepgram Transcription Started`);
  logger.fileLog(`Logging to file: ${LOG_FILE}`);
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {
    speakers: false,
    filePatterns: []
  };
  
  // Process arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--speakers') {
      options.speakers = true;
    } else {
      options.filePatterns.push(args[i]);
    }
  }
  
  if (options.filePatterns.length === 0) {
    logger.error("Please provide at least one file path or pattern as an argument");
    console.log('\n' + chalk.yellow('Usage: node transcribe.js [options] "*.mp3"'));
    console.log(chalk.yellow('Options:'));
    console.log(chalk.yellow('  --speakers    Enable speaker recognition (diarization)'));
    process.exit(1);
  }

  // Log options being used
  if (options.speakers) {
    logger.info('Speaker recognition (diarization) enabled');
  }
  
  logger.info(`Processing patterns: ${options.filePatterns.join(', ')}`);

  // Expand all glob patterns into file paths
  spinner.start('Finding files to process...');
  let filesToProcess = [];
  
  for (const pattern of options.filePatterns) {
    // If it's a direct file path that exists, add it
    if (fs.existsSync(pattern) && fs.statSync(pattern).isFile()) {
      filesToProcess.push(pattern);
      spinner.text = `Found ${filesToProcess.length} files to process...`;
    } 
    // Otherwise treat it as a glob pattern
    else {
      const matches = await glob(pattern);
      logger.fileLog(`Pattern '${pattern}' matched ${matches.length} files`);
      filesToProcess = filesToProcess.concat(matches);
      spinner.text = `Found ${filesToProcess.length} files to process...`;
    }
  }
  
  if (filesToProcess.length === 0) {
    spinner.fail(chalk.red("No matching files found for the provided patterns"));
    process.exit(1);
  }
  
  // Initialize CLI status
  cliStatus.totalFiles = filesToProcess.length;
  
  // Success message about files found
  spinner.succeed(chalk.green(`Found ${filesToProcess.length} files to process`));
  
  // Process each file
  const startTime = Date.now();
  
  // Process files in sequence
  for (const file of filesToProcess) {
    try {
      await transcribeFile(file, options);
    } catch (err) {
      logger.error(`Unexpected error processing ${file}: ${err}`);
    }
  }
  
  const processingDuration = (Date.now() - startTime) / 1000;
  
  // Calculate total duration
  const totalDuration = cliStatus.fileResults.reduce((sum, result) => sum + result.duration, 0);
  
  // Clear the space for summary
  console.log('\n\n');
  
  // Create a summary table
  const summaryTable = new Table({
    head: [
      chalk.blue.bold('Summary Metric'), 
      chalk.blue.bold('Value')
    ],
    style: { head: [], border: [] }
  });
  
  // Add rows to the summary table
  summaryTable.push(
    ['Files Processed', `${chalk.green(cliStatus.filesProcessed)} of ${cliStatus.totalFiles}`],
    ['Total Audio Duration', `${chalk.yellow((totalDuration / 60).toFixed(2))} minutes`],
    ['Total Processing Time', `${chalk.yellow(processingDuration.toFixed(2))} seconds`],
    ['Total Estimated Cost', `${chalk.green('$' + cliStatus.totalCost.toFixed(4))}`],
    ['Log File', `${chalk.cyan(LOG_FILE)}`]
  );
  
  // Print the summary table with a title
  console.log(chalk.bold.blue('\n📊 TRANSCRIPTION SUMMARY 📊'));
  console.log(summaryTable.toString());
  
  // Create a table for file details if there are results
  if (cliStatus.fileResults.length > 0) {
    console.log(chalk.bold.blue('\n📋 FILE BREAKDOWN 📋'));
    
    const fileTable = new Table({
      head: [
        chalk.blue.bold('File'), 
        chalk.blue.bold('Status'),
        chalk.blue.bold('Duration (min)'), 
        chalk.blue.bold('Cost'), 
        chalk.blue.bold('Size (MB)'),
        chalk.blue.bold('Model'),
        chalk.blue.bold('Speakers')
      ],
      style: { head: [], border: [] },
      colWidths: [30, 10, 15, 15, 12, 10, 10]
    });
    
    // Sort by cost (most expensive first)
    cliStatus.fileResults.sort((a, b) => b.cost - a.cost);
    
    // Add rows for each file
    cliStatus.fileResults.forEach(result => {
      const status = result.skipped ? chalk.cyan('Skipped') : chalk.green('Processed');
      const duration = result.skipped ? '-' : chalk.yellow((result.duration / 60).toFixed(2));
      const cost = result.skipped ? '$0.0000' : chalk.green('$' + result.cost.toFixed(4));
      const speakers = result.skipped ? '-' : (result.speakers ? chalk.green('Yes') : chalk.yellow('No'));
      
      fileTable.push([
        chalk.white(result.filename),
        status,
        duration,
        cost,
        chalk.cyan(result.fileSize),
        chalk.magenta(result.model),
        speakers
      ]);
    });
    
    // Print the file table
    console.log(fileTable.toString());
  }
  
  // Final success message
  console.log('\n' + chalk.green.bold('✨ Transcription complete! ✨'));
  console.log(chalk.blue('─'.repeat(50)) + '\n');
  
  // Log to file for record keeping
  logger.fileLog(`\n===== Transcription Summary =====`);
  logger.fileLog(`Files processed: ${cliStatus.filesProcessed} of ${cliStatus.totalFiles}`);
  logger.fileLog(`Total audio duration: ${(totalDuration / 60).toFixed(2)} minutes`);
  logger.fileLog(`Total processing time: ${processingDuration.toFixed(2)} seconds`);
  logger.fileLog(`Total estimated cost: $${cliStatus.totalCost.toFixed(4)}`);
  
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