/**
 * JWT utilities for authentication
 * Handles token generation and verification
 */
import jwt, { SignOptions } from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ?? '7d') as SignOptions['expiresIn'];

/**
 * JWT payload structure
 * Contains user identity information
 */
export interface JWTPayload {
  id: string;
  email: string;
  role: string;
  organization_id: string;
  /** User.token_version at sign-in; a mismatch means the session was revoked */
  tv?: number;
}

/**
 * Generate JWT token
 * @param payload - User data to encode in token
 * @returns Signed JWT token string
 */
export const generateToken = (payload: JWTPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Verify JWT token
 * @param token - JWT token string to verify
 * @returns Decoded payload if valid
 */
export const verifyToken = (token: string): JWTPayload => {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
};
