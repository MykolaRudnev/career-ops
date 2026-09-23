export const ELIGIBILITY = Object.freeze(Object.fromEntries(['WORLDWIDE','EMEA','EUROPE','EU_EEA','POLAND','COUNTRY_LIST','US_ONLY','CANADA_ONLY','UK_ONLY','LATAM_ONLY','APAC_ONLY','INDIA_ONLY','TIMEZONE_RESTRICTED','UNKNOWN'].map(x=>[x,x])));
const pl = /\b(?:pl|poland|polska|warsaw|warszawa|krak[oó]w|wroc[lł]aw|pozna[nń]|gda[nń]sk|gdynia|tr[oó]jmiasto|katowice|lublin|gliwice)\b|łódź/i;
const singleCountry = s => /^(?:us|usa|united states(?: of america)?)$/i.test(s) ? 'US_ONLY' : /^(?:ca|canada)$/i.test(s) ? 'CANADA_ONLY' : /^(?:gb|uk|united kingdom)$/i.test(s) ? 'UK_ONLY' : /^(?:in|india)$/i.test(s) ? 'INDIA_ONLY' : pl.test(s) ? 'POLAND' : null;
export function classifyEligibility(job) {
  const countries = (job?.eligibleCountries || []).map(x=>String(x?.name || x?.alpha2 || x).trim()).filter(Boolean);
  // Structured restrictions win over incidental company/office prose.
  if (countries.length > 1) return 'COUNTRY_LIST';
  if (countries.length === 1) return singleCountry(countries[0]) || 'COUNTRY_LIST';
  const location = String(job?.locationRaw || job?.location || '').trim();
  const desc = String(job?.description || '').replace(/<[^>]*>/g,' ');
  const restricted = desc.match(/(?:must (?:live|reside|be based)|(?:only )?open to (?:candidates|residents)|(?:must be |be )?authori[sz]ed to work) in (?:the )?(united states|usa|us\b|canada|united kingdom|uk\b|india)/i);
  if (restricted) return singleCountry(restricted[1]);
  // International access must describe this role, not merely a global company.
  const international = /(?:open to|hire|hiring|accept|welcome).{0,50}(?:international|global) contractors|(?:role|position|work).{0,40}(?:from anywhere|from any country)|international contractors (?:welcome|accepted|eligible)/i.test(desc);
  if (international) return 'WORLDWIDE';
  if (/worldwide|anywhere|any country|global remote|remote global/i.test(location) || job?.worldwide === true) return 'WORLDWIDE';
  if (/\bemea\b/i.test(location)) return 'EMEA';
  if (/\beu\b|eea|european union|european economic area/i.test(location)) return 'EU_EEA';
  if (/\beurope\b/i.test(location)) return 'EUROPE';
  if (pl.test(location)) return 'POLAND';
  const cleaned = location.replace(/\b(?:remote|only|hybrid|onsite)\b/gi,'').replace(/^[\s,()\-]+|[\s,()\-]+$/g,'');
  const one = singleCountry(cleaned);
  if (one) return one;
  if (/\b(?:us|usa|united states)\b/i.test(location) && !/canada|europe|\buk\b/i.test(location)) return 'US_ONLY';
  if (/\bcanada\b/i.test(location)) return /\b(?:us|usa|united states)\b/i.test(location) ? 'COUNTRY_LIST' : 'CANADA_ONLY';
  if (/\b(?:uk|united kingdom)\b/i.test(location)) return 'UK_ONLY';
  if (/latam|latin america/i.test(location)) return 'LATAM_ONLY';
  if (/\bapac\b/i.test(location)) return 'APAC_ONLY';
  if (/\bindia\b/i.test(location)) return 'INDIA_ONLY';
  if (job?.timezoneRestrictions?.length || /\b(?:utc|gmt)[+-]\d|time ?zones?/i.test(location)) return 'TIMEZONE_RESTRICTED';
  return 'UNKNOWN';
}
export function eligibilityPriority(value, countries = []) {
  if (['WORLDWIDE','EMEA','EUROPE','EU_EEA','POLAND'].includes(value) || (value==='COUNTRY_LIST' && countries.some(x=>pl.test(String(x))))) return 'HIGH';
  if (value==='INDIA_ONLY') return 'SKIP';
  if (['US_ONLY','CANADA_ONLY','UK_ONLY','LATAM_ONLY','APAC_ONLY'].includes(value)) return 'LOW';
  return 'REVIEW';
}
