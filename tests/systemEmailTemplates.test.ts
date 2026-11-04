import { renderSystemEmail, renderTemplateString, type SystemEmailName } from '../src/utils/systemEmailTemplates';

describe('renderTemplateString', () => {
  it('escapes {{var}} and leaves {{{var}}} raw', () => {
    expect(renderTemplateString('{{a}}|{{{a}}}', { a: '<b>x</b>' })).toBe('&lt;b&gt;x&lt;/b&gt;|<b>x</b>');
  });

  it('does not escape when escape is false (subjects, plain text)', () => {
    expect(renderTemplateString('Hi {{name}}', { name: 'Tom & Jerry' }, { escape: false })).toBe('Hi Tom & Jerry');
  });

  it('handles each with nested if/else and outer-scope lookups', () => {
    const out = renderTemplateString(
      '{{#each items}}[{{#if warn}}!{{else}}ok{{/if}} {{label}} {{site}}]{{/each}}',
      { site: 'S', items: [{ warn: true, label: 'a' }, { warn: false, label: 'b' }] }
    );
    expect(out).toBe('[! a S][ok b S]');
  });

  it('renders missing values as empty and fails loudly on broken blocks', () => {
    expect(renderTemplateString('x{{missing}}y', {})).toBe('xy');
    expect(() => renderTemplateString('{{#if a}}open', {})).toThrow(/Unclosed block/);
    expect(() => renderTemplateString('{{/each}}', {})).toThrow(/Unexpected closing tag/);
  });
});

describe('CRM360 system email templates', () => {
  const base = { full_name: 'Ada <Admin>', assets_base_url: 'https://cdn.example.com/email', support_url: 'https://help.example.com' };
  const cases: Array<[SystemEmailName, Record<string, unknown>]> = [
    ['verify-email', { otp: '12345', expires_in_minutes: 10 }],
    ['reset-password', { otp: '54321' }],
    ['staff-otp', { otp: '11111', expires_in_minutes: 10 }],
    ['welcome', {}],
    [
      'notification',
      {
        update_count: 2,
        notifications_url: 'https://app.example.com/notifications',
        updates: [
          { html: 'Deal moved to <strong>Proposal</strong>', text: 'Deal moved to Proposal', is_warning: false },
          { html: '<strong>Action required:</strong> sign', text: 'Sign', is_warning: true }
        ]
      }
    ],
    [
      'new-lead',
      {
        lead_name: 'Grace Hopper',
        lead_title: 'CTO',
        lead_est_arr: '$48,000',
        lead_source: 'Website',
        lead_intent_score: 82,
        lead_intent_label: 'High Priority',
        lead_url: 'https://app.example.com/revenue-engine'
      }
    ]
  ];

  it.each(cases)('%s renders subject, html and text with every placeholder filled', (name, data) => {
    const email = renderSystemEmail(name, { ...base, ...data });
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/\{\{/);
      expect(part.length).toBeGreaterThan(0);
    }
    expect(email.html).toContain('https://cdn.example.com/email/logo.png');
    expect(email.html).toContain('Ada &lt;Admin&gt;');
    expect(email.html).not.toContain('Ada <Admin>');
  });

  it('puts the code in the verification email and its subject', () => {
    const email = renderSystemEmail('verify-email', { ...base, otp: '12345', expires_in_minutes: 10 });
    expect(email.subject).toContain('12345');
    expect(email.html).toContain('12345');
  });

  it('renders each notification update, keeping trusted HTML', () => {
    const [, data] = cases[4];
    const email = renderSystemEmail('notification', { ...base, ...data });
    expect(email.html).toContain('Deal moved to <strong>Proposal</strong>');
    expect(email.html).toContain('<strong>Action required:</strong> sign');
    expect(email.text).toContain('[Action required] Sign');
  });
});
