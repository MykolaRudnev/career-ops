// Integration policy belongs to discovery, separate from candidate facts/ranking.
const api = (endpoint, cacheHours = 8, extra = {}) => ({ integrationType:'PUBLIC_API', endpoint, cacheHours, auth:'none', sourcePriority:40, ...extra });
export const SOURCE_POLICIES = {
  arbeitnow:api('https://www.arbeitnow.com/api/job-board-api'),
  thehub:api('https://thehub.io/api/v2/jobsandfeatured'),
  solidjobs:api('https://solid.jobs/public-api/offers/IT?campaign=career-ops-mykola',2,{integrationType:'OFFICIAL_API',sourcePriority:20}),
  himalayas:api('https://himalayas.app/jobs/api',24),
  jobgether:api('https://jobgether.com/api/v1/jobs',8,{sourceType:'AGGREGATOR_API',sourcePriority:60}),
  jobicy:api('https://jobicy.com/api/v2/remote-jobs?count=200'),
  remoteok:api('https://remoteok.com/api'),
  remotive:api('https://remotive.com/api/remote-jobs',24),
  landingjobs:api('https://landing.jobs/api/v1/jobs'),
  weworkremotely:api('https://weworkremotely.com/remote-jobs.rss',8,{integrationType:'PUBLIC_RSS'}),
  nodesk:api('https://nodesk.co/remote-jobs/index.xml',8,{integrationType:'PUBLIC_RSS'}),
  justjoin:api('https://justjoin.it/api/candidate-api/offers',1,{sourcePriority:20}),
  nofluffjobs:api('https://nofluffjobs.com/api/search/posting',1,{sourcePriority:20}),
  pracuj:api('https://www.pracuj.pl',8,{integrationType:'SEARCH_ONLY',sourcePriority:50}),
  protocol:api('https://theprotocol.it',8,{integrationType:'SEARCH_ONLY',sourcePriority:20}),
  bulldogjob:api('https://bulldogjob.com',8,{integrationType:'SEARCH_ONLY',sourcePriority:30}),
  epraca:api('https://oferty.praca.gov.pl/integration/services/v2/oferta',24,{integrationType:'OFFICIAL_API',auth:'ministry-assigned EPRACA_PARTNER',sourceType:'EPRACA_OFFICIAL',sourcePriority:70}),
  ziprecruiter:{integrationType:'DISABLED_BLOCKED',status:'DISABLED',reason:'Browser discovery retired; official MCP not connected',endpoint:null,auth:'n/a',cacheHours:24,sourcePriority:100},
  greenhouse:api('https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true',8,{integrationType:'PUBLIC_ATS',sourcePriority:0}),
  lever:api('https://api.{eu.}lever.co/v0/postings/{site}?mode=json',8,{integrationType:'PUBLIC_ATS',sourcePriority:0}),
  ashby:api('https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true',8,{integrationType:'PUBLIC_ATS',sourcePriority:0}),
  personio:api('https://{company}.jobs.personio.{de|com}/xml?language=en',8,{integrationType:'PUBLIC_XML',sourcePriority:0}),
};
export const SEARCH_SOURCES = [
  ['Pracuj.pl','pracuj.pl'],['theprotocol.it','theprotocol.it'],['Bulldogjob','bulldogjob.pl'],
  ['Jobs.pl','jobs.pl'],['RocketJobs','rocketjobs.pl'],['LinkedIn Poland','linkedin.com/jobs'],['Indeed Poland','pl.indeed.com'],
].map(([name,domain])=>({name,domain,integrationType:'SEARCH_ONLY',status:'DEGRADED',reason:'Search-engine discovery; no verified open candidate API',sourcePriority:50}));
