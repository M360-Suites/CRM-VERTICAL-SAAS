import crypto from 'crypto';

/**
 * Generate a public key for lead capture (safe to expose in client-side code)
 * Format: pk_live_<48 hex chars>
 */
export const generatePublicKey = (): string => {
  const random = crypto.randomBytes(24).toString('hex');
  return `pk_live_${random}`;
};

/**
 * Generate a secret key for backend-only operations
 * Format: sk_live_<48 hex chars>
 */
export const generateSecretKey = (): string => {
  const random = crypto.randomBytes(24).toString('hex');
  return `sk_live_${random}`;
};

/**
 * Generate both public and secret keys for an organization
 */
export const generateApiKeys = (): { publicKey: string; secretKey: string } => {
  return {
    publicKey: generatePublicKey(),
    secretKey: generateSecretKey()
  };
};
