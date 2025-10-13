import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import { ResumeAnalysisResponseDto } from './dto/resume-analysis.dto';

@Injectable()
export class ResumeAnalysisService {
  private openRouterApiKey: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.openRouterApiKey = apiKey;
  }

  async parseResumeContent(buffer: Buffer, mimetype: string): Promise<string> {
    try {
      if (mimetype === 'application/pdf') {
        const data = await pdfParse(buffer);
        return data.text;
      } else if (
        mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimetype === 'application/msword'
      ) {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      } else {
        throw new BadRequestException('Unsupported file format. Please upload PDF or DOC/DOCX files only.');
      }
    } catch (error) {
      throw new BadRequestException(`Error parsing resume: ${error.message}`);
    }
  }

  async analyzeResume(resumeContent: string, jobDescription: string): Promise<ResumeAnalysisResponseDto> {
    try {
      const prompt = `
You are an expert HR analyst. Analyze the following resume against the job description and provide a JSON response with:

1. A compatibility score (0-100) based on how well the candidate matches the job requirements
2. An array of missing skills that the candidate lacks but are mentioned in the job description
3. Extract the candidate's name from the resume
4. A motivational description that mentions the candidate's name and encourages them while highlighting their strengths and areas for improvement

RESUME:
${resumeContent}

JOB DESCRIPTION:
${jobDescription}

IMPORTANT: Respond ONLY with valid JSON in this exact format (no additional text or explanation):
{
  "compatibilityScore": 85,
  "missingSkills": ["Docker", "Kubernetes", "GraphQL"],
  "candidateName": "John Doe",
  "motivationalDescription": "Great job John! Your experience with Node.js and React makes you a strong candidate. Consider learning Docker to boost your score even higher!"
}

Be encouraging and professional in your motivational description. Highlight their strengths and suggest improvements positively.
`;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openRouterApiKey}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'HireReady Backend',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are an expert HR analyst who provides accurate, helpful, and encouraging resume analysis.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        throw new BadRequestException(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const completion = await response.json();
      console.log('OpenRouter Response:', JSON.stringify(completion, null, 2));
      
      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) {
        console.log('No response text found in completion:', completion);
        throw new BadRequestException('Failed to get analysis from AI service');
      }

      console.log('AI Response Text:', responseText);

      try {
        // Clean the response text by removing markdown code blocks
        let cleanResponseText = responseText.trim();
        
        // Remove ```json and ``` markers if present
        if (cleanResponseText.startsWith('```json')) {
          cleanResponseText = cleanResponseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanResponseText.startsWith('```')) {
          cleanResponseText = cleanResponseText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        console.log('Cleaned Response Text:', cleanResponseText);
        
        const analysisResult = JSON.parse(cleanResponseText);
        console.log('Parsed Analysis Result:', analysisResult);
        
        // Validate the response structure
        if (
          typeof analysisResult.compatibilityScore !== 'number' ||
          !Array.isArray(analysisResult.missingSkills) ||
          typeof analysisResult.candidateName !== 'string' ||
          typeof analysisResult.motivationalDescription !== 'string'
        ) {
          console.log('Validation failed for:', analysisResult);
          throw new Error('Invalid response format from AI');
        }

        return analysisResult;
      } catch (parseError) {
        console.log('JSON Parse Error:', parseError);
        console.log('Raw response text:', responseText);
        throw new BadRequestException(`Invalid response format from AI service. Error: ${parseError.message}`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Error analyzing resume: ${error.message}`);
    }
  }
}
