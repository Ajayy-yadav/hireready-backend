export interface InterviewMessage {
  type: 'question' | 'answer' | 'status' | 'audio' | 'transcript' | 'error';
  sessionId?: string;
  content?: string;
  audio?: string; // Base64 encoded audio
  currentQuestion?: number;
  totalQuestions?: number;
  isComplete?: boolean;
  error?: string;
}

export interface ConversationHistory {
  role: 'system' | 'user' | 'assistant';
  content: string;
}


