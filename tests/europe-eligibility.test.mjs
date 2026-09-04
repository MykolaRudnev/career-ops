import { strict as assert } from 'node:assert';
import { classifyEligibility, eligibilityPriority } from '../discovery/eligibility.mjs';

assert.equal(classifyEligibility({ location: 'Remote worldwide' }), 'WORLDWIDE');
assert.equal(classifyEligibility({ location: 'Remote, EMEA' }), 'EMEA');
assert.equal(classifyEligibility({ location: 'Remote Europe' }), 'EUROPE');
assert.equal(classifyEligibility({ location: 'Remote India' }), 'INDIA_ONLY');
assert.equal(classifyEligibility({ location: 'Remote US only' }), 'US_ONLY');
assert.equal(classifyEligibility({ location: 'Remote', description: '' }), 'UNKNOWN');
assert.equal(eligibilityPriority('INDIA_ONLY'), 'SKIP');
assert.equal(eligibilityPriority('EUROPE'), 'HIGH');
console.log('✓ Europe eligibility classification and India-only exclusion');
