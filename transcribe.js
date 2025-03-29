#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require("@deepgram/sdk");
const fs = require("fs");
const path = require("path");
const glob = require("glob");
const util = require('util');

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
    
    // Calculate the cost of the transcription
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
    
    // Calculate and log the cost
    const costInfo = calculateCost(result.metadata.duration, result.metadata.model_info);
    
    // Store cost info in global for batch processing summary
    global.lastTranscriptionCost = costInfo.estimatedCost;
    global.lastTranscriptionDuration = result.metadata.duration;
    
    // Log detailed metadata for debugging/cost analysis
    logger.log(`Metadata: ${JSON.stringify({
      duration: result.metadata.duration,
      channels: result.metadata.channels,
      model: result.metadata.model_info,
      request_id: result.metadata.request_id,
      cost: {
        model: costInfo.model,
        pricePerMinute: `$${costInfo.pricePerMinute.toFixed(4)}`,
        durationInMinutes: costInfo.durationInMinutes.toFixed(2),
        estimatedCost: `$${costInfo.estimatedCost.toFixed(4)}`
      }
    }, null, 2)}`);
    
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
  let totalCost = 0;
  let totalDuration = 0;
  const startTime = Date.now();
  const fileResults = [];
  
  for (const file of filesToProcess) {
    try {
      // Add a hook to capture the cost from the transcription process
      global.lastTranscriptionCost = null;
      global.lastTranscriptionDuration = null;
      
      const success = await transcribeFile(file);
      
      if (success) {
        successCount++;
        
        // Collect cost information if available
        if (global.lastTranscriptionCost) {
          totalCost += global.lastTranscriptionCost;
          fileResults.push({
            file,
            cost: global.lastTranscriptionCost,
            duration: global.lastTranscriptionDuration
          });
          
          if (global.lastTranscriptionDuration) {
            totalDuration += global.lastTranscriptionDuration;
          }
        }
      }
    } catch (err) {
      logger.error(`Unexpected error processing ${file}: ${err}`);
    }
  }
  
  const processingDuration = (Date.now() - startTime) / 1000;
  
  // Log processing summary with costs
  logger.log(`\n===== Transcription Summary =====`);
  logger.log(`Files processed: ${successCount} of ${filesToProcess.length}`);
  logger.log(`Total audio duration: ${(totalDuration / 60).toFixed(2)} minutes`);
  logger.log(`Total processing time: ${processingDuration.toFixed(2)} seconds`);
  logger.log(`Total estimated cost: $${totalCost.toFixed(4)}`);
  
  // Log individual file costs
  if (fileResults.length > 0) {
    logger.log(`\n===== File Cost Breakdown =====`);
    fileResults.forEach(result => {
      logger.log(`${result.file}: $${result.cost.toFixed(4)} (${(result.duration / 60).toFixed(2)} minutes)`);
    });
  }
  
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

