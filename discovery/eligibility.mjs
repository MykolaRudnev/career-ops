export const ELIGIBILITY = Object.freeze({
  WORLDWIDE:'WORLDWIDE', EMEA:'EMEA', EUROPE:'EUROPE', EU_EEA:'EU_EEA', EU_ONLY:'EU_ONLY', POLAND:'POLAND',
  COUNTRY_LIST:'COUNTRY_LIST', US_ONLY:'US_ONLY', CANADA_ONLY:'CANADA_ONLY', UK_ONLY:'UK_ONLY', LATAM_ONLY:'LATAM_ONLY',
  APAC_ONLY:'APAC_ONLY', INDIA_ONLY:'INDIA_ONLY', TIMEZONE_RESTRICTED:'TIMEZONE_RESTRICTED', UNKNOWN:'UNKNOWN',
});

const has = (s, re) => re.test(s);
export function classifyEligibility(job) {
  if (job?.eligibility && ELIGIBILITY[job.eligibility]) return job.eligibility;
  const s = [job?.location, job?.locationRaw, job?.description, ...(job?.eligibleCountries || []), ...(job?.timezoneRestrictions || [])].filter(Boolean).join(' ').toLowerCase();
  if (has(s, /\b(remote\s+india|india\s+only|must (?:live|reside|be based) in india|indian work authori[sz]ation)\b/)) return ELIGIBILITY.INDIA_ONLY;
  if (has(s, /\b(worldwide|anywhere|any country|globally remote|remote global)\b/)) return ELIGIBILITY.WORLDWIDE;
  if (has(s, /\bemea\b/)) return ELIGIBILITY.EMEA;
  if (has(s, /\b(eu\/eea|eea|european economic area)\b/)) return ELIGIBILITY.EU_EEA;
  if (has(s, /\b(eu only|european union only)\b/)) return ELIGIBILITY.EU_ONLY;
  if (has(s, /\b(remote europe|europe only|europe-wide|europe)\b/)) return ELIGIBILITY.EUROPE;
  if (has(s, /\b(poland|polska|warsaw|warszawa|krakow|kraków|wroclaw|wrocław|lublin)\b/)) return ELIGIBILITY.POLAND;
  if (has(s, /\b(remote\s+us|us only|usa only|united states only|must (?:live|reside|be based) in (?:the )?(?:us|usa|united states))\b/)) return ELIGIBILITY.US_ONLY;
  if (has(s, /\b(remote\s+uk|uk only|united kingdom only|must (?:live|reside|be based) in (?:the )?uk)\b/)) return ELIGIBILITY.UK_ONLY;
  if (has(s, /\b(remote\s+canada|canada only)\b/)) return ELIGIBILITY.CANADA_ONLY;
  if (has(s, /\b(latam only|latin america only|remote latam)\b/)) return ELIGIBILITY.LATAM_ONLY;
  if (has(s, /\b(apac only|remote apac)\b/)) return ELIGIBILITY.APAC_ONLY;
  if (has(s, /\b(?:utc|gmt)[+-]\d{1,2}|\b(?:pst|est|cst|mst)\b/)) return ELIGIBILITY.TIMEZONE_RESTRICTED;
  return ELIGIBILITY.UNKNOWN;
}

export function eligibilityPriority(value) {
  if ([ELIGIBILITY.WORLDWIDE,ELIGIBILITY.EMEA,ELIGIBILITY.EUROPE,ELIGIBILITY.EU_EEA,ELIGIBILITY.EU_ONLY,ELIGIBILITY.POLAND].includes(value)) return 'HIGH';
  if (value === ELIGIBILITY.INDIA_ONLY) return 'SKIP';
  if ([ELIGIBILITY.US_ONLY,ELIGIBILITY.CANADA_ONLY,ELIGIBILITY.UK_ONLY,ELIGIBILITY.LATAM_ONLY,ELIGIBILITY.APAC_ONLY].includes(value)) return 'LOW';
  return 'REVIEW';
}
