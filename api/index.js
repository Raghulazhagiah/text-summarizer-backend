const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const natural = require('natural');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Gemini AI if API key is available
let genAI = null;
if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here') {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// Alternative summarization function using TF-IDF
function summarizeText(text, numSentences = 3) {
    const tokenizer = new natural.SentenceTokenizer();
    const textSentences = tokenizer.tokenize(text);
    
    if (textSentences.length <= numSentences) {
        return text;
    }

    const tfidf = new natural.TfIdf();
    tfidf.addDocument(text);

    // Calculate sentence scores
    const sentenceScores = textSentences.map((sentence, index) => {
        const score = tfidf.tfidf(sentence, 0);
        return { sentence, score, index };
    });

    // Sort sentences by score and get top N
    const topSentences = sentenceScores
        .sort((a, b) => b.score - a.score)
        .slice(0, numSentences)
        .sort((a, b) => a.index - b.index)
        .map(item => item.sentence);

    return topSentences.join(' ');
}

// Summarization endpoint
app.post('/api/summarize', async (req, res) => {
    try {
        const { text, method = 'auto' } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        let summary;
        
        if (method === 'gemini' && genAI) {
            // Use Gemini AI
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });
            const prompt = `Please provide a concise summary of the following text:\n\n${text}`;
            const result = await model.generateContent(prompt);
            const response = await result.response;
            summary = response.text();
        } else {
            // Use alternative method
            summary = summarizeText(text);
        }

        res.json({ 
            summary,
            method: method === 'gemini' && genAI ? 'gemini' : 'tfidf'
        });
    } catch (error) {
        console.error('Error:', error);
        // Fallback to alternative method if Gemini fails
        try {
            const summary = summarizeText(req.body.text);
            res.json({ 
                summary,
                method: 'tfidf',
                note: 'Fell back to alternative method due to Gemini API error'
            });
        } catch (fallbackError) {
            res.status(500).json({ error: 'Failed to generate summary' });
        }
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok',
        geminiAvailable: !!genAI
    });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`Gemini API ${genAI ? 'is' : 'is not'} available`);
}); 