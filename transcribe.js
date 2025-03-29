#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require("@deepgram/sdk");
const fs = require("fs");
const path = require("path");
const glob = require("glob");

const transcribeFile = async (inputFilePath) => {
  console.log(`Processing: ${inputFilePath}`);
  
  // STEP 1: Create a Deepgram client using the API key
  const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

  try {
    // STEP 2: Call the transcribeFile method with the audio payload and options
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

    // STEP 5: Print the transcript to console
    console.log("\nTranscript:");
    console.log(paragraphText);
    
    // STEP 6: Write the transcript to a file
    const outputPath = `${inputFilePath}.txt`;
    fs.writeFileSync(outputPath, paragraphText);
    console.log(`\nTranscript saved to: ${outputPath}`);
    
    return true;
  } catch (err) {
    console.error(`Error during transcription of ${inputFilePath}:`, err);
    return false;
  }
};

// Main function to process files
const processFiles = async () => {
  // Get input patterns from command line arguments
  const filePatterns = process.argv.slice(2);
  
  if (filePatterns.length === 0) {
    console.error("Please provide at least one file path or pattern as an argument");
    process.exit(1);
  }

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
      filesToProcess = filesToProcess.concat(matches);
    }
  }
  
  if (filesToProcess.length === 0) {
    console.error("No matching files found for the provided patterns");
    process.exit(1);
  }
  
  console.log(`Found ${filesToProcess.length} files to process`);
  
  // Process each file
  let successCount = 0;
  for (const file of filesToProcess) {
    const success = await transcribeFile(file);
    if (success) successCount++;
  }
  
  console.log(`\nCompleted processing ${successCount} of ${filesToProcess.length} files`);
};

// Run the main function
processFiles();

