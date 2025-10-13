import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LlmService {
  private openRouterApiKey: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }
    this.openRouterApiKey = apiKey;
  }

  /**
   * OPTIMIZED: Generate ALL interview questions at once (single API call)
   * This eliminates LLM delay between questions!
   */
  async generateAllQuestions(
    jobDesc: string,
    totalQuestions: number
  ): Promise<string[]> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openRouterApiKey}`,
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'HireReady Backend',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are an AI interviewer. Generate EXACTLY ${totalQuestions} relevant interview questions based on the job description.

Requirements:
- Generate EXACTLY ${totalQuestions} questions
- Mix technical, behavioral, and situational questions
- Each question should be concise (under 2 sentences)
- Questions should be directly relevant to the job
- Return ONLY the questions, one per line, numbered

Format:
1. [First question]
2. [Second question]
3. [Third question]
...`,
          },
          { 
            role: 'user', 
            content: `Job Description:\n${jobDesc}\n\nGenerate ${totalQuestions} interview questions.` 
          },
        ],
        temperature: 0.8,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const completion = await response.json();
    const text = completion.choices[0]?.message?.content || '';

    // Parse numbered questions
    const questions = text
      .split('\n')
      .filter(line => /^\d+\./.test(line.trim())) // Lines starting with "1.", "2.", etc.
      .map(line => line.replace(/^\d+\.\s*/, '').trim()) // Remove numbering
      .filter(q => q.length > 0);

    // Ensure we have enough questions
    if (questions.length < totalQuestions) {
      console.warn(`LLM only generated ${questions.length} questions, expected ${totalQuestions}`);
      // Pad with generic questions if needed
      while (questions.length < totalQuestions) {
        questions.push(`Tell me more about your experience related to this role.`);
      }
    }

    return questions.slice(0, totalQuestions);
  }

  /**
   * Legacy method - kept for fallback compatibility
   */
  async llmResponse(
    jobDesc: string,
    history: Array<{ role: string; content: string }>
  ) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openRouterApiKey}`,
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'HireReady Backend',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are an AI interviewer. Ask concise, relevant interview questions based on the job description. Keep questions under 2 sentences.`,
          },
          { role: 'system', content: `Job Description:\n${jobDesc}` },
          ...history,
          {
            role: 'user',
            content: `Ask the next interview question.`,
          },
        ],
        temperature: 0.7,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const completion = await response.json();
    return completion.choices[0]?.message?.content;
  }

  /**
   * Generate comprehensive interview feedback based on conversation history
   */
  async generateInterviewFeedback(
    jobDesc: string,
    history: Array<{ role: string; content: string }>
  ): Promise<{
    overallScore: number;
    strengths: string[];
    areasForImprovement: string[];
    detailedFeedback: string;
    recommendations: string[];
  }> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openRouterApiKey}`,
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'HireReady Backend',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are an expert interview evaluator. Analyze the interview conversation and provide comprehensive feedback.

Your response MUST be a valid JSON object with this exact structure:
{
  "overallScore": <number 1-10>,
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "areasForImprovement": ["area 1", "area 2", "area 3"],
  "detailedFeedback": "A detailed paragraph analyzing the candidate's performance",
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
}

Evaluate based on:
- Technical knowledge and accuracy
- Communication clarity
- Problem-solving approach
- Relevance to job requirements
- Confidence and professionalism`,
          },
          { 
            role: 'user', 
            content: `Job Description:\n${jobDesc}\n\nInterview Conversation:\n${JSON.stringify(history, null, 2)}\n\nProvide detailed feedback in JSON format.` 
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const completion = await response.json();
    const content = completion.choices[0]?.message?.content || '{}';
    
    try {
      // Try to parse the JSON response
      const feedback = JSON.parse(content);
      
      // Validate structure
      if (!feedback.overallScore || !feedback.strengths || !feedback.areasForImprovement) {
        throw new Error('Invalid feedback structure');
      }
      
      return feedback;
    } catch (parseError) {
      // Fallback if JSON parsing fails
      return {
        overallScore: 7,
        strengths: ['Completed the interview', 'Provided responses to questions'],
        areasForImprovement: ['More detailed answers needed', 'Better technical depth'],
        detailedFeedback: content,
        recommendations: ['Practice technical concepts', 'Work on communication skills'],
      };
    }
  }
}
