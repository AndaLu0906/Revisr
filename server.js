require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const axios = require('axios');

const app = express();
const port = 8000; // Port for the backend server

// Middleware
app.use(cors());
app.use(express.json());

// Setup multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// The main upload endpoint
app.post('/api/upload', upload.fields([{ name: 'paper', maxCount: 1 }, { name: 'rubricFile', maxCount: 1 }]), async (req, res) => {
  console.log('--- /api/upload endpoint hit at ' + new Date().toISOString() + ' ---');
  try {
    if (!req.files || !req.files.paper || !req.files.paper[0]) {
      return res.status(400).send('Paper file is required.');
    }
    const paperFile = req.files.paper[0];
    const rubricFile = req.files.rubricFile ? req.files.rubricFile[0] : null;
    const rubricText = req.body.rubricText;
    const educationLevel = req.body.educationLevel || 'High School'; // Default to High School
    const customPrompt = req.body.customPrompt || '';

    // Helper function to extract text
    const extractText = async (file) => {
      if (file.mimetype === 'application/pdf') {
        const data = await pdf(file.buffer);
        return data.text;
      } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const { value } = await mammoth.extractRawText({ buffer: file.buffer });
        return value;
      } else {
        return file.buffer.toString('utf8');
      }
    };

    // 1. Extract text from paper and rubric
    const paperContent = await extractText(paperFile);
    let rubricContent = 'No rubric provided. Grade based on general academic standards.';
    if (rubricFile) {
      rubricContent = await extractText(rubricFile);
    } else if (rubricText) {
      rubricContent = rubricText;
    }

    // --- Multi-Step AI Analysis --- //
    console.log('Starting multi-step AI analysis...');

    const extractAndParseJson = (text, context) => {
      console.log(`--- Raw AI Response for ${context} Start ---`);
      console.log(text);
      console.log(`--- Raw AI Response for ${context} End ---`);

      const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      let jsonString = markdownMatch ? markdownMatch[1] : text;

      const firstBracket = jsonString.indexOf('{');
      const lastBracket = jsonString.lastIndexOf('}');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        jsonString = jsonString.substring(firstBracket, lastBracket + 1);
      } else {
        throw new Error(`No valid JSON object found in AI response for ${context}.`);
      }

      try {
        return JSON.parse(jsonString);
      } catch (e) {
        console.error(`Failed to parse JSON for ${context}:`, e.message);
        throw new Error(`The AI returned malformed JSON for ${context}.`);
      }
    };

    const callAI = async (system_prompt, user_prompt, context, timeout = 60000) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        console.log(`Calling AI for ${context} with a ${timeout/1000}s timeout.`);
        const ollamaResponse = await axios.post('http://localhost:11434/api/generate', {
          model: 'llama3',
          prompt: user_prompt,
          system: system_prompt,
          format: 'json',
          stream: false,
          options: { num_ctx: 8192 }
        }, { signal: controller.signal });
        
        clearTimeout(timeoutId);
        const responseText = ollamaResponse.data.response.trim();
        return extractAndParseJson(responseText, context);
      } catch (error) {
        clearTimeout(timeoutId);
        if (axios.isCancel(error)) {
          console.error(`AI call for ${context} timed out after ${timeout/1000} seconds.`);
          throw new Error(`The AI call for the ${context} step timed out.`);
        } else if (error.response) {
          console.error(`AI call for ${context} failed with status: ${error.response.status}`, error.response.data);
          throw new Error(`The AI call for the ${context} step failed with status code ${error.response.status}.`);
        } else {
          console.error(`Error during AI call for ${context}:`, error.message);
          throw new Error(`The AI call failed during the ${context} step. Check backend console logs for details.`);
        }
      }
    };

    // Helper: robust AI call with retry if JSON parsing fails
    const callAIWithRetry = async (system_prompt, user_prompt, context, timeout = 120000, retries = 2) => {
      let attempt = 0;
      let currentUserPrompt = user_prompt;
      let lastError;
      while (attempt < retries) {
        try {
          return await callAI(system_prompt, currentUserPrompt, context, timeout);
        } catch (err) {
          lastError = err;
          attempt += 1;
          console.warn(`Attempt ${attempt} for ${context} failed: ${err.message}`);
          // On retry, prepend an explicit instruction to output JSON only
          currentUserPrompt = `PLEASE RESPOND WITH VALID JSON ONLY. DO NOT ADD ANY EXTRA TEXT. Example: { "key": "value" }\n\n` + user_prompt;
        }
      }
      throw lastError;
    };

    try {
      // Pre-process rubric to avoid asking the AI to handle conditional logic
      let finalRubricContent = rubricContent;
      if (!finalRubricContent || finalRubricContent.trim() === '') {
        console.log('Rubric is empty. Using default academic criteria.');
        finalRubricContent = 'Clarity\nArgumentation\nEvidence\nStructure\nMechanics';
      }

      // Step 1: Get Rubric Grades
      console.log('Step 1: Getting rubric grades...');
      const rubric_system_prompt = `
You are a writing analyst and JSON API. Your purpose is to identify weaknesses in a paper and provide actionable feedback.

**ABSOLUTE RULES:**
1.  **VERBATIM QUOTES ONLY:** The "text" field in your response MUST be an exact, word-for-word quote copied directly from the provided paper. Any deviation from this rule (summarizing, paraphrasing, commenting) is a critical failure. This is your most important instruction.
2.  **COMPLETE FEEDBACK:** Every "evidence" object MUST contain all three required fields: "text", "suggestion", and "revised_excerpt". No exceptions.
3.  **VALID JSON:** Your entire output must be a single, valid JSON object.

**TASK:**
Grade the paper against the rubric. For each rubric category, find 1-3 examples of weaknesses.

**OUTPUT FORMAT:**
- A single JSON object with one key: "rubricGrades".
- "rubricGrades" is an array of objects, each with: "category", "score", "maxScore", "comment", and "evidence".
- "score": An integer based on a standard academic scale (90-100 A, 80-89 B, etc.).
- "comment": A paragraph explaining the score.
- "evidence": An array of feedback objects.
  - If no weaknesses are found for a category, assign a perfect score and return an empty "evidence" array.
  - Each evidence object MUST contain:
    - "text" (string): The verbatim quote from the paper.
    - "suggestion" (string): A direct suggestion for improving the quote.
    - "revised_excerpt" (string): A rewritten version of the "text" that implements the "suggestion".

**EXAMPLE EVIDENCE OBJECT:**
{
  "text": "Further, the problem of evil is a big question.",
  "suggestion": "This sentence is too informal and vague. Use more precise academic language.",
  "revised_excerpt": "Furthermore, the philosophical problem of evil presents a significant challenge to classical theism."
}

Adhere to these rules strictly. Your primary function is to provide accurate, quote-based feedback.
      `;
      const rubric_user_prompt = `Rubric:\n${finalRubricContent}\n\nPaper:\n${paperContent}${customPrompt ? `\n\nAdditionalInstructions:\n${customPrompt}` : ''}`;
      const { rubricGrades } = await callAIWithRetry(rubric_system_prompt, rubric_user_prompt, 'RubricGrading', 300000); // 5 min timeout

      // Validate rubricGrades structure early to avoid TypeErrors later
      if (!Array.isArray(rubricGrades)) {
        throw new Error('AI response did not contain a valid "rubricGrades" array.');
      }

      // Process the response to find indices and validate
      const normalizeString = (str) => {
        if (!str) return '';
        return str
          .replace(/[\u2018\u2019]/g, "'") // Convert smart single quotes
          .replace(/[\u201C\u201D]/g, '"') // Convert smart double quotes
          .replace(/\s+/g, ' ')           // Collapse whitespace
          .trim();
      };

      if (rubricGrades && Array.isArray(rubricGrades)) {
        const normalizedPaperContent = normalizeString(paperContent);

        for (const grade of rubricGrades) {
          // Skip null or invalid grade objects
          if (!grade || typeof grade.score !== 'number' || typeof grade.maxScore !== 'number') {
            console.warn('Skipping invalid grade object:', grade);
            continue;
          }

          let validEvidence = [];
          // Check if evidence exists and is an array before trying to filter it
          if (grade.evidence && Array.isArray(grade.evidence)) {
            validEvidence = grade.evidence.filter(ev => {
              // Must have all three fields to be considered valid
              if (!ev || !ev.text || !ev.suggestion || !ev.revised_excerpt) {
                return false;
              }
              // Also, filter out items where the AI has returned a placeholder error message instead of real content.
              if (ev.text.includes('[AI ERROR') || ev.suggestion.includes('[AI did not provide')) {
                console.warn('Filtering out evidence item with AI placeholder error.');
                return false;
              }
              return true;
            });
          }

          grade.evidence = validEvidence; // Replace original evidence with the filtered list

          // Now, check if there's no valid evidence.
          if (grade.evidence.length === 0) {
            // If the AI gave a perfect score anyway, the comment should be positive.
            if (grade.score === grade.maxScore) {
              grade.comment = "Excellent work in this category. No specific areas for improvement were identified.";
            } else {
              // If the score was NOT perfect, it means the AI failed to justify its score.
              // Preserve the score and add a note.
              grade.comment += " (Note: The AI failed to provide valid examples to justify its score.)";
            }
          }

          // Process remaining valid evidence (if any)
          for (const ev of grade.evidence) {
            // Validate the text quote.
            const normalizedAiText = normalizeString(ev.text);
            if (normalizedPaperContent.includes(normalizedAiText)) {
              // The quote is valid and found in the paper.
              const startIndex = paperContent.indexOf(ev.text);
              if (startIndex !== -1) {
                ev.start_index = startIndex;
                ev.end_index = startIndex + ev.text.length;
              } else {
                ev.start_index = -1;
                ev.end_index = -1;
              }
            } else {
              // The quote is not in the paper. Per user request, we will no longer prepend a warning.
              // The text will be displayed exactly as the AI provided it.
              console.warn(`AI-provided text not found in paper: \"${ev.text}\"`);
              ev.start_index = -1;
              ev.end_index = -1;
            }
          }
        }
      }



      // Compute overall score based on rubric grades
      console.log('Computing overall score...');
      const computeOverall = (grades) => {
        if (!Array.isArray(grades)) {
          console.warn('computeOverall: rubricGrades is not an array. Defaulting to 0.');
          return 0;
        }

        // Filter out any null, undefined, or malformed grade objects before computing.
        const validGrades = grades.filter(g => 
          g && typeof g === 'object' && typeof g.score === 'number' && typeof g.maxScore === 'number'
        );

        if (validGrades.length === 0) {
          console.warn('computeOverall: No valid grade objects found for score computation. Defaulting to 0.');
          return 0;
        }

        console.log('Valid grades for score computation:', JSON.stringify(validGrades, null, 2));
        
        const totalPercent = validGrades.reduce((acc, g) => {
          const pct = g.maxScore > 0 ? (g.score / g.maxScore) : 0;
          return acc + pct;
        }, 0) / validGrades.length; // CRITICAL: Divide by the count of VALID grades.

        const finalScore = Math.round(totalPercent * 100);
        console.log(`Computed score: ${finalScore}`);
        return finalScore;
      };
      const overallScore = computeOverall(rubricGrades);
      console.log(`Final overall score: ${overallScore}`);

      // Final Assembly
      console.log('All steps complete. Assembling final response...');
      const responsePayload = {
        overallScore,
        rubricGrades,

        paperContent,
      };
      console.log('Final response payload keys:', Object.keys(responsePayload));

      res.json(responsePayload);
      console.log('Final response sent to client.');

    } catch (error) {
      console.error('Error during multi-step AI analysis. Message:', error.message);
      console.error('Stacktrace:', error.stack);
      res.status(500).json({
        error: 'Failed to get feedback from the AI.',
        details: error.message,
        // DO NOT include paperContent here, it can cause memory crashes on large files.
      });
    }

  } catch (error) {
    console.error('!!! Error processing upload !!!');
    console.error('Message:', error.message);
    console.error('Stacktrace:', error.stack);
    if (error.response) {
      console.error('--- Error Response Data ---');
      console.error(error.response.data);
      console.error('---------------------------');
    }
    const details = error.message || 'Unknown server error';
    res.status(500).json({ error: 'Server processing error', details });
  }
});

app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});
