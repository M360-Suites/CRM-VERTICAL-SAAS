process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.BACKEND_URL = 'https://api.example.com';

jest.mock('../src/config', () => ({
  __esModule: true,
  default: { JWT_SECRET: 'test-secret', BACKEND_URL: 'https://api.example.com' }
}));

import {
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  renderEmail,
  renderMergeTags,
  verifyUnsubscribeToken
} from '../src/utils/emailTemplateRender';

describe('email template rendering', () => {
  it('fills merge tags and falls back when a value is missing', () => {
    const out = renderMergeTags('Hi {{contact.first_name | there}}, re {{deal.title}}', { 'deal.title': 'Redesign' }, { html: false });
    expect(out).toBe('Hi there, re Redesign');
  });

  it('escapes values in html but not in the subject', () => {
    const rendered = renderEmail(
      { subject: 'For {{company.name}}', html: '<p>{{company.name}}</p>' },
      { company: { name: 'A & B <Co>' } }
    );
    expect(rendered.subject).toBe('For A & B <Co>');
    expect(rendered.html).toBe('<p>A &amp; B &lt;Co&gt;</p>');
  });

  it('appends an unsubscribe footer when the template has no link of its own', () => {
    const rendered = renderEmail(
      { subject: 's', html: '<html><body><p>Hello</p></body></html>' },
      { unsubscribe_url: 'https://x.test/u?token=a&b=1' }
    );
    expect(rendered.html).toContain('href="https://x.test/u?token=a&amp;b=1"');
    expect(rendered.html.indexOf('Unsubscribe')).toBeLessThan(rendered.html.indexOf('</body>'));
  });

  it('does not add a second footer when the template already links {{unsubscribe_url}}', () => {
    const rendered = renderEmail(
      { subject: 's', html: '<a href="{{unsubscribe_url}}">Opt out</a>' },
      { unsubscribe_url: 'https://x.test/u' }
    );
    expect(rendered.html).toBe('<a href="https://x.test/u">Opt out</a>');
  });

  it('formats deal value and full name', () => {
    const rendered = renderEmail(
      { subject: '{{contact.full_name}}', html: '{{deal.value}} {{deal.currency}}' },
      { contact: { first_name: 'Ada', last_name: 'Lovelace' }, deal: { value: 12500, currency: 'USD' } }
    );
    expect(rendered.subject).toBe('Ada Lovelace');
    expect(rendered.html).toBe('12,500 USD');
  });

  it('uses fallback values only where the context has none', () => {
    const rendered = renderEmail(
      { subject: '{{contact.first_name}} at {{organization.name}}', html: '' },
      { organization: { name: 'Acme' } },
      { 'contact.first_name': 'Ada', 'organization.name': 'Sample Org' }
    );
    expect(rendered.subject).toBe('Ada at Acme');
  });
});

describe('unsubscribe tokens', () => {
  const contactId = '64b7f0c2a1b2c3d4e5f60718';

  it('round-trips a contact id', () => {
    expect(verifyUnsubscribeToken(createUnsubscribeToken(contactId))).toBe(contactId);
  });

  it('rejects tampered tokens', () => {
    const [, signature] = createUnsubscribeToken(contactId).split('.');
    const forged = `${Buffer.from('64b7f0c2a1b2c3d4e5f60719').toString('base64url')}.${signature}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
    expect(verifyUnsubscribeToken('garbage')).toBeNull();
  });

  it('builds a link to the public unsubscribe endpoint', () => {
    expect(buildUnsubscribeUrl(contactId)).toMatch(/^https:\/\/api\.example\.com\/api\/v1\/public\/email\/unsubscribe\?token=/);
  });
});
