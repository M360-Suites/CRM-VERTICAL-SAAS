import { IUser } from '../models/User';

export const isInvalidGoogleGrantError = (error: any): boolean => {
  const googleError = error?.response?.data?.error || error?.cause?.message || error?.message;
  return googleError === 'invalid_grant';
};

export const getSafeGoogleErrorLog = (error: any): Record<string, unknown> => ({
  status: error?.response?.status || error?.code,
  googleError: error?.response?.data?.error,
  googleDescription: error?.response?.data?.error_description,
  message: error?.message
});

export const clearGmailConnection = async (user: IUser): Promise<void> => {
  user.google_access_token = undefined;
  user.google_refresh_token = undefined;
  user.gmail_sync_enabled = false;
  user.last_gmail_sync_at = undefined;
  await user.save();
};
