import config from '../config';

type SocialProvider = 'whatsapp' | 'instagram' | 'facebook_messenger';

const BASE_URL = `https://${config.UNIPILE_DSN}/api/v1`;

const headers = () => ({
  'X-API-KEY': config.UNIPILE_API_KEY || '',
  'Content-Type': 'application/json',
});

const providerMap: Record<SocialProvider, string> = {
  whatsapp: 'WHATSAPP',
  instagram: 'INSTAGRAM',
  facebook_messenger: 'MESSENGER',
};

export const generateConnectUrl = async (
  provider: SocialProvider,
  successRedirectUrl: string,
  failureRedirectUrl: string,
  notifyUrl: string,
  userId: string
): Promise<{ url: string }> => {
  const requestBody = {
    type: 'create',
    providers: [providerMap[provider]],
    api_url: BASE_URL,
    expiresOn: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    success_redirect_url: successRedirectUrl,
    failure_redirect_url: failureRedirectUrl,
    notify_url: notifyUrl,
    name: userId,
  };

  console.log('[generateConnectUrl] Request to Unipile:', {
    url: `${BASE_URL}/hosted/accounts/link`,
    headers: { 'X-API-KEY': '***' + (config.UNIPILE_API_KEY || '').slice(-4) },
    body: requestBody
  });

  const response = await fetch(`${BASE_URL}/hosted/accounts/link`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Unipile connect failed: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as unknown as { link?: string; url?: string };
  const url = data.link || data.url;
  if (!url) {
    throw new Error('Unipile did not return a connect URL');
  }
  return { url };
};

export const disconnectAccount = async (accountId: string): Promise<void> => {
  const response = await fetch(`${BASE_URL}/accounts/${accountId}`, {
    method: 'DELETE',
    headers: headers(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Unipile disconnect failed: ${response.status} ${errorBody}`);
  }
};
