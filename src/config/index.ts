/**
 * Application configuration module
 * Validates and exports required environment variables
 */
import dotenv from 'dotenv';
dotenv.config();

const required = [
  'PORT',
  'MONGODB_URI',
  'JWT_SECRET',
  'ENSEND_SECRET',
  'GROQ_API_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET'
] as const;
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
}

/**
 * Application configuration object
 * Contains server port, MongoDB URI, JWT secret, and expiration time
 */
const config = {
  PORT: Number(process.env.PORT!),
  MONGODB_URI: process.env.MONGODB_URI!,
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '7d',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  ORIGIN: process.env.ORIGIN,
  FRONTEND_URL: process.env.FRONTEND_URL,
  GOOGLE_EMAIL_REDIRECT_URI: process.env.GOOGLE_EMAIL_REDIRECT_URI,
  ENSEND_SECRET: process.env.ENSEND_SECRET!,
  ENSEND_NAME: process.env.ENSEND_NAME,
  ENSEND_MAIL: process.env.ENSEND_MAIL,
  FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY,
  SWAGGER_ENABLED: process.env.SWAGGER_ENABLED !== 'false',
  GROQ_API_KEY: process.env.GROQ_API_KEY!,
  GROQ_MODEL: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME!,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY!,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET!
};

export default config;
