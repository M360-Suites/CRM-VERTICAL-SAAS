jest.mock('../src/config', () => ({
  __esModule: true,
  default: { SENDER_API_TOKEN: 'token', SENDER_FROM_EMAIL: 'hello@mail.test', SENDER_FROM_NAME: 'CRM' }
}));

import { isSenderRateLimited, sendEmail, SenderRateLimitError } from '../src/utils/senderMailer';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'status',
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  json: async () => body
});

describe('sendEmail (Sender.net)', () => {
  beforeEach(() => fetchMock.mockReset());

  it('posts to the transactional endpoint and returns the email id', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { success: true, emailId: 'e-1' }));

    const id = await sendEmail({
      to: 'ada@example.com',
      toName: 'Ada',
      subject: 'Hi',
      html: '<p>Hello</p>',
      fromName: 'Acme "Ltd"',
      replyTo: 'owner@acme.test',
      unsubscribeUrl: 'https://api.test/unsub'
    });

    expect(id).toBe('e-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.sender.net/v2/message/send');
    expect(init.headers.Authorization).toBe('Bearer token');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      from: { email: 'hello@mail.test', name: 'Acme Ltd' },
      to: { email: 'ada@example.com', name: 'Ada' },
      subject: 'Hi',
      html: '<p>Hello</p>',
      text: 'Hello'
    });
    expect(body.headers).toMatchObject({
      'List-Unsubscribe': '<https://api.test/unsub>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Reply-To': 'owner@acme.test'
    });
  });

  it('throws the API message on errors', async () => {
    fetchMock.mockResolvedValueOnce(reply(422, { message: 'The from.email must be a verified sender' }));
    await expect(sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })).rejects.toThrow(
      'Sender.net 422: The from.email must be a verified sender'
    );
  });

  it('backs off after a 429 without calling the API again', async () => {
    fetchMock.mockResolvedValueOnce(reply(429, {}, { 'retry-after': '30' }));

    await expect(sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })).rejects.toBeInstanceOf(SenderRateLimitError);
    expect(isSenderRateLimited()).toBe(true);
    await expect(sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })).rejects.toBeInstanceOf(SenderRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
