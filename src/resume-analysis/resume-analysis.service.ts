import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import { ResumeAnalysisResponseDto } from './dto/resume-analysis.dto';

@Injectable()
export class ResumeAnalysisService {
  private readonly logger = new Logger(ResumeAnalysisService.name);
  private openRouterApiKey: string;

  // Validation constants
  private readonly MIN_RESUME_LENGTH = 100;
  private readonly MIN_JOB_DESC_LENGTH = 50;
  private readonly MAX_RESUME_LENGTH = 50000;
  private readonly MAX_JOB_DESC_LENGTH = 10000;
  private readonly COMPLETE_MISMATCH_THRESHOLD = 15;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }
    this.openRouterApiKey = apiKey;
  }

  async parseResumeContent(buffer: Buffer, mimetype: string): Promise<string> {
    try {
      let extractedText = '';

      if (mimetype === 'application/pdf') {
        const data = await pdfParse(buffer);
        extractedText = data.text;
      } else if (
        mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimetype === 'application/msword'
      ) {
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value;
      } else {
        throw new BadRequestException('Unsupported file format. Please upload PDF or DOC/DOCX files only.');
      }

      // Validate extracted text
      const cleanedText = extractedText.trim();
      if (!cleanedText || cleanedText.length < this.MIN_RESUME_LENGTH) {
        throw new BadRequestException(
          `Resume content is too short (minimum ${this.MIN_RESUME_LENGTH} characters). Please upload a valid resume with sufficient information.`
        );
      }

      if (cleanedText.length > this.MAX_RESUME_LENGTH) {
        throw new BadRequestException(
          `Resume content is too long (maximum ${this.MAX_RESUME_LENGTH} characters). Please upload a more concise resume.`
        );
      }

      return cleanedText;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Error parsing resume: ${error.message}`);
    }
  }

  async analyzeResume(resumeContent: string, jobDescription: string, userId?: string): Promise<ResumeAnalysisResponseDto> {
    try {
      // Validate inputs
      this.validateInputs(resumeContent, jobDescription);

      const prompt = `You are an expert HR analyst. Analyze the resume against the job description.

CRITICAL VALIDATION:
- If the resume and job description are COMPLETELY UNRELATED (different industries, no overlapping skills, candidate experience irrelevant to role), set compatibilityScore to 0-15 and set "isCompleteMismatch": true
- If there's ANY reasonable relevance, set "isCompleteMismatch": false and score accordingly

RESUME:
${resumeContent}

JOB DESCRIPTION:
${jobDescription}

Provide a JSON response with:
1. compatibilityScore (0-100): How well the candidate matches the job requirements
2. missingSkills: Array of required skills the candidate lacks (max 10 most important)
3. candidateName: Extract from resume (if not found, use "Candidate")
4. motivationalDescription: Professional, encouraging feedback highlighting strengths and growth areas
5. isCompleteMismatch: boolean - true if resume is entirely irrelevant to the job
6. mismatchReason: string (only if isCompleteMismatch is true) - brief explanation of the mismatch

IMPORTANT: Respond ONLY with valid JSON (no markdown, no extra text):
{
  "compatibilityScore": 85,
  "missingSkills": ["Docker", "Kubernetes"],
  "candidateName": "John Doe",
  "motivationalDescription": "Great work, John! Your Node.js and React experience aligns well with this role. Consider learning Docker to further strengthen your profile.",
  "isCompleteMismatch": false,
  "mismatchReason": null
}

Be accurate, encouraging, and professional.`;

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
              content: 'You are an expert HR analyst who provides accurate, helpful, and encouraging resume analysis. Always respond with valid JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 1200,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`OpenRouter API error: ${response.status} - ${errorText}`);
        throw new BadRequestException(`AI service error: ${response.status} ${response.statusText}`);
      }

      const completion = await response.json();
      const responseText = completion.choices[0]?.message?.content;
      
      if (!responseText) {
        this.logger.error('No response text from AI service');
        throw new BadRequestException('Failed to get analysis from AI service');
      }

      const analysisResult = this.parseAndValidateResponse(responseText);

      // Check for complete mismatch
      if (analysisResult.isCompleteMismatch) {
        throw new BadRequestException(
          `Resume mismatch detected: ${analysisResult.mismatchReason || 'The resume does not match the job requirements. Please upload a relevant resume for this position.'}`
        );
      }

      // Save latest score to user table (if userId provided)
      if (userId) {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            latestResumeScore: analysisResult.compatibilityScore,
            lastResumeAnalysisAt: new Date(),
          },
        });
        this.logger.log(`Updated user ${userId} with resume score: ${analysisResult.compatibilityScore}`);
      }

      return analysisResult;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error analyzing resume: ${error.message}`, error.stack);
      throw new BadRequestException(`Error analyzing resume: ${error.message}`);
    }
  }

  /**
   * Validate input lengths and quality
   */
  private validateInputs(resumeContent: string, jobDescription: string): void {
    if (!resumeContent || resumeContent.trim().length < this.MIN_RESUME_LENGTH) {
      throw new BadRequestException(
        `Resume content is too short (minimum ${this.MIN_RESUME_LENGTH} characters required)`
      );
    }

    if (resumeContent.length > this.MAX_RESUME_LENGTH) {
      throw new BadRequestException(
        `Resume content is too long (maximum ${this.MAX_RESUME_LENGTH} characters allowed)`
      );
    }

    if (!jobDescription || jobDescription.trim().length < this.MIN_JOB_DESC_LENGTH) {
      throw new BadRequestException(
        `Job description is too short (minimum ${this.MIN_JOB_DESC_LENGTH} characters required)`
      );
    }

    if (jobDescription.length > this.MAX_JOB_DESC_LENGTH) {
      throw new BadRequestException(
        `Job description is too long (maximum ${this.MAX_JOB_DESC_LENGTH} characters allowed)`
      );
    }
  }

  /**
   * Parse and validate AI response
   */
  private parseAndValidateResponse(responseText: string): any {
    try {
      // Clean the response text by removing markdown code blocks
      let cleanResponseText = responseText.trim();
      
      // Remove ```json and ``` markers if present
      if (cleanResponseText.startsWith('```json')) {
        cleanResponseText = cleanResponseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponseText.startsWith('```')) {
        cleanResponseText = cleanResponseText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      const analysisResult = JSON.parse(cleanResponseText);
      
      // Validate the response structure
      if (
        typeof analysisResult.compatibilityScore !== 'number' ||
        !Array.isArray(analysisResult.missingSkills) ||
        typeof analysisResult.candidateName !== 'string' ||
        typeof analysisResult.motivationalDescription !== 'string' ||
        typeof analysisResult.isCompleteMismatch !== 'boolean'
      ) {
        this.logger.error('Invalid response structure from AI');
        throw new Error('Invalid response format from AI');
      }

      // Validate score range
      if (analysisResult.compatibilityScore < 0 || analysisResult.compatibilityScore > 100) {
        this.logger.error(`Invalid compatibility score: ${analysisResult.compatibilityScore}`);
        throw new Error('Compatibility score must be between 0 and 100');
      }

      // Ensure missingSkills is not excessively long
      if (analysisResult.missingSkills.length > 20) {
        analysisResult.missingSkills = analysisResult.missingSkills.slice(0, 20);
      }

      // Handle mismatch reason
      if (analysisResult.isCompleteMismatch && !analysisResult.mismatchReason) {
        analysisResult.mismatchReason = 'The resume does not match the job requirements';
      }

      return analysisResult as ResumeAnalysisResponseDto;
    } catch (parseError) {
      this.logger.error(`JSON Parse Error: ${parseError.message}`);
      throw new BadRequestException(`Invalid response format from AI service: ${parseError.message}`);
    }
  }
}
