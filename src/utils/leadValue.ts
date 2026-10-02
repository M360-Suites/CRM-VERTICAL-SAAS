/**
 * Turn a free-form budget/value from a lead form into a deal value.
 *
 * Accepts numbers and strings such as "5000", "$5,000", "5k", "€1.2m",
 * "5k-10k" / "$5,000 to $10,000" (midpoint), "10k+" / "under 5k" (the stated
 * number). Returns undefined when nothing usable is given so the deal value
 * stays unknown instead of becoming 0.
 */
export const parseLeadValue = (raw: unknown): number | undefined => {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : undefined;
  if (typeof raw !== 'string') return undefined;

  const text = raw.toLowerCase().replace(/,/g, '').trim();
  if (!text || text.length > 100) return undefined;

  const amounts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(k|m|thousand|million)?/g)]
    .map(([, amount, suffix]) => {
      const multiplier = suffix === 'k' || suffix === 'thousand' ? 1_000 : suffix === 'm' || suffix === 'million' ? 1_000_000 : 1;
      return Number(amount) * multiplier;
    })
    .filter((amount) => Number.isFinite(amount) && amount > 0);

  if (amounts.length === 0) return undefined;

  // "5k-10k" style ranges: use the midpoint of the first two numbers
  const value = amounts.length >= 2 ? (amounts[0] + amounts[1]) / 2 : amounts[0];
  return value > 0 && value <= 1_000_000_000_000 ? Math.round(value * 100) / 100 : undefined;
};

/** Field names lead forms commonly use for a deal value, in priority order */
export const LEAD_VALUE_FIELDS = [
  'value',
  'deal_value',
  'dealValue',
  'estimated_value',
  'budget',
  'Budget',
  'amount',
  'Amount'
];
