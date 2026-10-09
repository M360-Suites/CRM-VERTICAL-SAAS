import { extractCustomFields } from '../src/utils/customFields';

describe('extractCustomFields', () => {
  const known = ['key', 'email', 'name'];

  it('keeps a customFields object with its value types', () => {
    const result = extractCustomFields(
      {
        key: 'pk_live_x',
        email: 'a@b.com',
        customFields: { propertyType: 'Apartment', budget: 50000000, preferredLocation: 'Lekki', bedrooms: 3 }
      },
      known
    );
    expect(result).toEqual({ propertyType: 'Apartment', budget: 50000000, preferredLocation: 'Lekki', bedrooms: 3 });
  });

  it('accepts the custom_fields alias', () => {
    expect(extractCustomFields({ custom_fields: { floor: 2 } }, known)).toEqual({ floor: 2 });
  });

  it('collects unrecognised top-level keys and skips known ones', () => {
    expect(extractCustomFields({ key: 'pk', email: 'a@b.com', utm_campaign: 'spring' }, known)).toEqual({
      utm_campaign: 'spring'
    });
  });

  it('lets customFields win over a top-level key of the same name', () => {
    expect(extractCustomFields({ bedrooms: '2', customFields: { bedrooms: 3 } }, known)).toEqual({ bedrooms: 3 });
  });

  it('drops unsafe keys, empty strings and over-deep nesting', () => {
    const result = extractCustomFields(
      {
        customFields: {
          $where: 'x',
          'a.b': 1,
          __proto__: { polluted: true },
          blank: '   ',
          deep: { l1: { l2: { l3: { l4: 'gone' } } } },
          ok: true
        }
      },
      known
    );
    expect(result).toEqual({ deep: { l1: { l2: {} } }, ok: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('caps the number of fields', () => {
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`f${i}`, i]));
    expect(Object.keys(extractCustomFields({ customFields: many }, known))).toHaveLength(50);
  });

  it('returns an empty object for non-object bodies', () => {
    expect(extractCustomFields(undefined, known)).toEqual({});
    expect(extractCustomFields('nope', known)).toEqual({});
  });
});
