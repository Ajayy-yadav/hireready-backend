import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class StartInterviewDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  jobDescription: string;

  @IsNumber()
  @IsOptional()
  @Min(3)
  @Max(10)
  totalQuestions?: number = 5;
}


