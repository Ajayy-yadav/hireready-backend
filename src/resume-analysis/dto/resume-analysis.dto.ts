import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ResumeAnalysisRequestDto {
  @ApiProperty({
    description: 'Job description text',
    example: 'We are looking for a Senior Software Engineer with 5+ years of experience in Node.js, React, and AWS...'
  })
  @IsString()
  @IsNotEmpty()
  jobDescription: string;
}

export class ResumeAnalysisResponseDto {
  @ApiProperty({
    description: 'Compatibility score between resume and job description (0-100)',
    example: 85
  })
  compatibilityScore!: number;

  @ApiProperty({
    description: 'Array of missing skills required for the job',
    example: ['Docker', 'Kubernetes', 'GraphQL']
  })
  missingSkills!: string[];

  @ApiProperty({
    description: 'Motivational description with candidate name',
    example: 'Great job John! Your experience with Node.js and React makes you a strong candidate. Consider learning Docker to boost your score even higher!'
  })
  motivationalDescription!: string;

  @ApiProperty({
    description: 'Extracted candidate name from resume',
    example: 'John Doe'
  })
  candidateName!: string;

  @ApiProperty({
    description: 'Indicates if the resume is completely unrelated to the job description',
    example: false
  })
  isCompleteMismatch!: boolean;

  @ApiProperty({
    description: 'Reason for mismatch (only present if isCompleteMismatch is true)',
    example: null,
    required: false
  })
  mismatchReason?: string | null;
}
