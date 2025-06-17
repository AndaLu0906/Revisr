# Revisr - AI Essay Grader

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-16.x-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-lightgrey.svg)](https://expressjs.com/)

An intelligent essay grading system that provides instant, detailed feedback on student writing using AI. This full-stack application helps educators and students by automating the essay review process with comprehensive rubric-based assessments.

## Features

- **AI-Powered Analysis**: Leverages advanced language models for comprehensive essay evaluation
- **Structured Feedback**: Provides detailed feedback on writing quality, structure, and content
- **Customizable Rubrics**: Supports custom rubrics for different assignment types
- **Real-time Processing**: Delivers instant feedback to users
- **Secure & Private**: All processing happens locally when using the self-hosted version

## Quick Start

### Prerequisites

- Node.js 16.x or later
- npm or yarn
- Ollama (for local AI processing)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/AndaLu0906/revisr.git
   cd revisr/backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the backend directory:
   ```env
   PORT=8000
   NODE_ENV=development
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Access the API**
   The API will be available at `http://localhost:8000`

## API Endpoints

- `POST /api/upload` - Submit an essay for grading
  - Requires: `paper` (file), `rubricFile` (optional), `rubricText` (optional)
  - Returns: Grading results with scores and feedback

## AI Integration

This project uses [Ollama](https://ollama.ai/) for local AI processing. Make sure to have Ollama installed and running with the desired model (e.g., llama3) before starting the server.

## Project Structure

```
backend/
├── node_modules/    # Dependencies
├── src/             # Source files
│   ├── routes/      # API routes
│   ├── services/    # Business logic
│   └── utils/       # Utility functions
├── .env             # Environment variables
├── package.json     # Project manifest
└── server.js        # Entry point
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built using Node.js and Express
- Powered by Ollama for local AI processing
- Inspired by the need for better educational tools
