const { GoogleGenerativeAI } = require('@google/generative-ai');
const natural = require('natural');
require('dotenv').config();

// Initialize Gemini AI if API key is available
let genAI = null;
try {
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here') {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        console.log('Gemini AI initialized successfully');
    } else {
        console.log('Gemini API key not found or invalid');
    }
} catch (error) {
    console.error('Error initializing Gemini AI:', error);
}

// Alternative summarization function using TF-IDF
function summarizeText(text, numSentences = 3) {
    try {
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
    } catch (error) {
        console.error('Error in summarizeText:', error);
        throw error;
    }
}

// Main handler for all requests
module.exports = async (req, res) => {
    try {
        console.log('Request received:', {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: req.body,
            env: {
                nodeEnv: process.env.NODE_ENV,
                hasGeminiKey: !!process.env.GEMINI_API_KEY,
                nodeVersion: process.version
            }
        });

        // Enable CORS
        res.setHeader('Access-Control-Allow-Credentials', true);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
        res.setHeader(
            'Access-Control-Allow-Headers',
            'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
        );

        // Handle OPTIONS request for CORS
        if (req.method === 'OPTIONS') {
            res.status(200).end();
            return;
        }

        // Handle root URL
        if (req.url === '/' || req.url === '') {
            return res.status(200).json({
                status: 'ok',
                message: 'Text Summarizer API is running',
                endpoints: {
                    health: '/api/health',
                    summarize: '/api/summarize (POST)'
                },
                usage: {
                    summarize: {
                        method: 'POST',
                        url: '/api/summarize',
                        body: {
                            text: 'Your text to summarize',
                            method: 'auto' // or 'gemini' or 'tfidf'
                        }
                    }
                }
            });
        }

        // Parse request body if it's a POST request
        let body;
        if (req.method === 'POST') {
            try {
                // In Vercel, the body is already parsed if Content-Type is application/json
                body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
                console.log('Parsed body:', body);
            } catch (e) {
                console.error('Error parsing request body:', e);
                return res.status(400).json({ 
                    error: 'Invalid JSON in request body',
                    details: e.message,
                    receivedBody: req.body
                });
            }
        }

        if (req.method === 'GET' && req.url === '/api/health') {
            try {
                const healthResponse = {
                    status: 'ok',
                    geminiAvailable: !!genAI,
                    environment: process.env.NODE_ENV,
                    nodeVersion: process.version,
                    envVars: {
                        hasGeminiKey: !!process.env.GEMINI_API_KEY,
                        nodeEnv: process.env.NODE_ENV
                    },
                    system: {
                        uptime: process.uptime(),
                        memoryUsage: process.memoryUsage(),
                        platform: process.platform
                    }
                };
                console.log('Health check response:', healthResponse);
                return res.status(200).json(healthResponse);
            } catch (healthError) {
                console.error('Error in health check:', healthError);
                return res.status(500).json({
                    error: 'Health check failed',
                    details: healthError.message,
                    stack: process.env.NODE_ENV === 'development' ? healthError.stack : undefined
                });
            }
        }

        if (req.method === 'POST' && req.url === '/api/summarize') {
            if (!body || !body.text) {
                return res.status(400).json({ 
                    error: 'Text is required in request body',
                    receivedBody: body,
                    bodyType: typeof body,
                    example: {
                        text: 'Your text to summarize',
                        method: 'auto'
                    }
                });
            }

            const { text, method = 'auto' } = body;
            console.log('Processing request with method:', method);
            
            let summary;
            
            if (method === 'gemini' && genAI) {
                console.log('Using Gemini AI for summarization');
                // Use Gemini AI
                const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                const prompt = `Please provide a concise summary of the following text:\n\n${text}`;
                const result = await model.generateContent(prompt);
                const response = await result.response;
                summary = response.text();
            } else {
                console.log('Using TF-IDF for summarization');
                // Use alternative method
                summary = summarizeText(text);
            }

            return res.status(200).json({ 
                summary,
                method: method === 'gemini' && genAI ? 'gemini' : 'tfidf'
            });
        }

        // Handle 404 for unknown routes
        return res.status(404).json({ 
            error: 'Not Found',
            path: req.url,
            method: req.method,
            availableEndpoints: {
                root: '/',
                health: '/api/health',
                summarize: '/api/summarize (POST)'
            }
        });
    } catch (error) {
        console.error('Error in main handler:', error);
        // Fallback to alternative method if Gemini fails
        try {
            if (!body || !body.text) {
                throw new Error('No text provided for fallback');
            }
            const summary = summarizeText(body.text);
            return res.status(200).json({ 
                summary,
                method: 'tfidf',
                note: 'Fell back to alternative method due to Gemini API error'
            });
        } catch (fallbackError) {
            console.error('Fallback error:', fallbackError);
            return res.status(500).json({ 
                error: 'Failed to generate summary',
                details: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
                requestInfo: {
                    method: req.method,
                    url: req.url,
                    bodyType: typeof req.body,
                    hasBody: !!req.body
                }
            });
        }
    }
}; 