import { parseLeadValue } from '../src/utils/leadValue';

describe('parseLeadValue', () => {
  it.each([
    [5000, 5000],
    ['5000', 5000],
    ['$5,000', 5000],
    ['5k', 5000],
    ['€1.2m', 1_200_000],
    ['2 million', 2_000_000],
    ['5k-10k', 7500],
    ['$5,000 to $10,000', 7500],
    ['10k+', 10_000],
    ['Under 5k', 5000],
    ['₦250,000', 250_000]
  ])('parses %p as %p', (input, expected) => {
    expect(parseLeadValue(input)).toBe(expected);
  });

  it.each([undefined, null, '', 0, -50, 'not sure', 'TBD', {}, ['5000'], NaN])(
    'leaves %p unknown instead of 0',
    (input) => {
      expect(parseLeadValue(input)).toBeUndefined();
    }
  );
});

describe('Deal value default', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Deal } = require('../src/models/Deal');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Types } = require('mongoose');

  it('lands at 0 when no value is given, or value is null', () => {
    const organization_id = new Types.ObjectId();
    expect(new Deal({ title: 'No budget', organization_id }).value).toBe(0);
    expect(new Deal({ title: 'Null budget', organization_id, value: null }).value).toBe(0);
    expect(new Deal({ title: 'Has budget', organization_id, value: 2500 }).value).toBe(2500);
  });
});
