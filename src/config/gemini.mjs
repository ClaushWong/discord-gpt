import { GoogleGenAI, DynamicRetrievalConfigMode } from '@google/genai';

// Initialize the Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function chat(message) {
  const response = await ai.models.generateContent({
    model: "models/gemini-2.5-flash-preview-05-20",
    contents: `${message}`,
    config: {
        tools: [
            {
                googleSearch: {}
            } 
        ]
    }
  });
  return response.text;
}
