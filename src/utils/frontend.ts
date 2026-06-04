import config from '../config';

export const getFrontendUrl = (override?: string): string => {
  const url = override || config.FRONTEND_URL || config.ORIGIN || 'http://localhost:3000';
  return url.replace(/\/$/, '');
};
