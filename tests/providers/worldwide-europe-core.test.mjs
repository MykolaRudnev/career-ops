import { strict as assert } from 'node:assert';
import { parseJobgetherResponse } from '../../providers/jobgether.mjs';
import { parseJobtechResponse } from '../../providers/jobtech-sweden.mjs';
import { parseAdzunaResponse } from '../../providers/adzuna.mjs';

console.log('\nProviders — Europe discovery core');
const [jg] = parseJobgetherResponse({ jobs: [{ id:'jg1', title:'Senior Frontend Engineer', company:'Acme', url:'https://jobgether.com/offer/jg1-role', location:'Europe', remote:'Full Remote', contractType:'Full time', experience:'Senior (5-10 years)', postedAt:'2026-09-01T00:00:00Z' }] });
assert.equal(jg.remoteType, 'Full Remote'); assert.equal(jg.sourceType, 'aggregator');
const [se] = parseJobtechResponse({ hits: [{ id:'314', headline:'Frontend Engineer', webpage_url:'https://arbetsformedlingen.se/platsbanken/annonser/314', employer:{name:'Elvy AB'}, workplace_address:{city:'STOCKHOLM',country:'Sverige'}, description:{text:'React and TypeScript web applications'}, publication_date:'2026-09-02T00:00:00Z', application_details:{url:'https://careers.example.com/jobs/314'} }] });
assert.equal(se.url, 'https://careers.example.com/jobs/314'); assert.equal(se.company, 'Elvy AB'); assert.match(se.description, /TypeScript/);
const [ad] = parseAdzunaResponse({ results: [{ id:'a1', title:'React Developer', redirect_url:'https://www.adzuna.co.uk/jobs/details/a1', company:{display_name:'Example Ltd'}, location:{display_name:'London'}, description:'React web role', created:'2026-09-01T00:00:00Z', salary_min:70000, salary_max:90000 }] }, 'gb');
assert.equal(ad.salaryCurrency, 'GBP'); assert.equal(ad.salaryMin, 70000);
assert.equal(parseJobgetherResponse({}).length, 0); assert.equal(parseJobtechResponse(null).length, 0); assert.equal(parseAdzunaResponse([]).length, 0);
console.log('✓ Jobgether, JobTech Sweden, and Adzuna normalization');
