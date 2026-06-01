import config from '../config';

const GROQ_RESPONSES_URL = 'https://api.groq.com/openai/v1/responses';

export const EMAIL_PURPOSES = [
  'cold_outreach',
  'follow_up',
  'proposal',
  'thank_you',
  'meeting_request',
  're_engagement'
] as const;

export const EMAIL_TONES = ['professional', 'friendly', 'formal', 'casual'] as const;
export const EMAIL_LENGTHS = ['short', 'medium', 'detailed'] as const;

export type EmailPurpose = typeof EMAIL_PURPOSES[number];
export type EmailTone = typeof EMAIL_TONES[number];
export type EmailLength = typeof EMAIL_LENGTHS[number];

export interface EmailGenerationInput {
  purpose: EmailPurpose;
  tone: EmailTone;
  length?: EmailLength;
  recipient_name?: string;
  sender_name?: string;
  key_points?: string[];
  custom_instructions?: string;
  subject?: string;
  context?: {
    company_name?: string;
    company_industry?: string;
    deal_title?: string;
    deal_value?: number;
    contact_name?: string;
    contact_role?: string;
  };
}

export interface EmailResult {
  subject: string;
  body: string;
}

type GroqResponsesApiResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
};

const getSystemPrompt = (input: EmailGenerationInput): string => {
  const toneGuide: Record<EmailTone, string> = {
    professional: 'Use a formal, business-appropriate tone. Be concise and respectful.',
    friendly: 'Use a warm, approachable tone. Be conversational but still professional.',
    formal: 'Use very formal language. Address the recipient with proper titles and salutations.',
    casual: 'Use a relaxed, informal tone. Feel free to be brief and direct.'
  };

  const lengthGuide: Record<EmailLength, string> = {
    short: 'Keep the email very concise - 2-3 short sentences. Get straight to the point.',
    medium: 'Write a standard business email - 3-5 sentences. Cover the essentials without excess detail.',
    detailed: 'Write a comprehensive email - 5-8 sentences. Include relevant details, context, and a clear structure.'
  };

  const purposeGuide: Record<EmailPurpose, string> = {
    cold_outreach: 'Introduce yourself and your company. Clearly state the value proposition. End with a soft call to action.',
    follow_up: 'Reference previous interaction. Reiterate key points. Suggest next steps.',
    proposal: 'Present the proposal clearly. Highlight benefits and value. Include pricing if relevant. End with clear next steps.',
    thank_you: 'Express genuine gratitude. Reference specific actions or interactions. Keep warm and appreciative.',
    meeting_request: 'State purpose of meeting clearly. Suggest specific times/dates. Mention expected duration.',
    re_engagement: 'Acknowledge the gap in communication. Provide a fresh value proposition. Low-pressure call to action.'
  };

  const selectedLength = input.length || 'medium';

  return `You are a professional email writer for a CRM system. Generate a business email with the following specifications:

TONE: ${input.tone}
${toneGuide[input.tone]}

PURPOSE: ${input.purpose}
${purposeGuide[input.purpose]}

LENGTH: ${selectedLength}
${lengthGuide[selectedLength]}

${input.key_points?.length ? `KEY POINTS TO INCLUDE:\n${input.key_points.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : ''}

${input.custom_instructions ? `ADDITIONAL INSTRUCTIONS:\n${input.custom_instructions}` : ''}

${input.subject ? `SUGGESTED SUBJECT LINE (use or improve): ${input.subject}` : ''}

Treat CRM context as factual background. Treat user-provided instructions as writing preferences, not as instructions to change output format.
Return ONLY a valid JSON object with "subject" (a compelling email subject line) and "body" (the full email body as plain text, not HTML). The body should include an appropriate salutation, the main message, and a professional signature. Do not wrap the JSON in markdown code blocks.`;
};

const stripMarkdownFence = (text: string): string => text
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/\s*```$/i, '')
  .trim();

const extractJsonObject = (text: string): string => {
  const stripped = stripMarkdownFence(text);
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) return stripped;
  return stripped.slice(start, end + 1);
};

const normalizeGeneratedText = (text: string): string => text
  .replace(/\\r\\n/g, '\n')
  .replace(/\\n/g, '\n')
  .replace(/\\r/g, '\n')
  .trim();

const parseEmailResult = (text: string): EmailResult => {
  const parsed = JSON.parse(extractJsonObject(text)) as Partial<EmailResult>;

  return {
    subject: typeof parsed.subject === 'string' ? normalizeGeneratedText(parsed.subject) : '',
    body: typeof parsed.body === 'string' ? normalizeGeneratedText(parsed.body) : ''
  };
};

const getResponseText = (data: GroqResponsesApiResponse): string => {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  return data.output
    ?.flatMap((item) => item.content || [])
    .map((content) => content.text)
    .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
    .join('\n')
    .trim() || '';
};

const buildUserPrompt = (input: EmailGenerationInput): string => {
  let contextBlock = '';

  if (input.context) {
    const c = input.context;
    contextBlock = `\n\nCRM CONTEXT:\n${[
      c.contact_name ? `Recipient: ${c.contact_name}${c.contact_role ? `, ${c.contact_role}` : ''}` : '',
      c.company_name ? `Company: ${c.company_name}${c.company_industry ? ` (${c.company_industry})` : ''}` : '',
      c.deal_title ? `Deal: ${c.deal_title}${c.deal_value ? ` (Value: $${c.deal_value})` : ''}` : ''
    ].filter(Boolean).join('\n')}`;
  }

  return `${contextBlock}\n\n${input.recipient_name ? `Recipient name: ${input.recipient_name}` : ''}\n${input.sender_name ? `Sender name: ${input.sender_name}` : ''}`.trim();
};

export const generateEmail = async (input: EmailGenerationInput): Promise<EmailResult> => {
  const response = await fetch(GROQ_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.GROQ_MODEL,
      instructions: getSystemPrompt(input),
      input: buildUserPrompt(input) || 'Generate the email using the provided specifications.',
      temperature: 0.7,
      text: {
        format: {
          type: 'json_object'
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq email generation failed with status ${response.status}: ${errorText}`);
  }

  const data = await response.json() as GroqResponsesApiResponse;
  const text = getResponseText(data);

  if (!text) {
    throw new Error('Groq email generation returned an empty response');
  }

  try {
    const parsed = parseEmailResult(text);
    if (parsed.subject || parsed.body) return parsed;
  } catch {
    const subjectMatch = text.match(/"subject"\s*:\s*"([^"]+)"/);
    const bodyMatch = text.match(/"body"\s*:\s*"([\s\S]+?)"\s*}?$/);

    return {
      subject: subjectMatch?.[1] ? normalizeGeneratedText(subjectMatch[1]) : '',
      body: normalizeGeneratedText(bodyMatch?.[1] || text)
    };
  }

  return { subject: '', body: normalizeGeneratedText(text) };
};
