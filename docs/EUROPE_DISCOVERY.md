# Additive Europe discovery lane

`portals.europe.yml` is deliberately separate from the user's existing
`portals.yml`. Run `node europe-discovery-report.mjs` for a safe discovery-only
scan. It never submits applications or modifies the tracker/pipeline.

## Enabled

| Source | Classification | Auth | Refresh / limits | Notes |
| --- | --- | --- | --- | --- |
| Jobgether | PUBLIC_API | None | 8h local cache; 25/page; max 10 API pages, configured 2 | Europe/worldwide remote. Result URL is a Jobgether listing, so it remains an aggregator source. Fair use asks callers to cache and keep volume reasonable. |
| Sweden JobTech | PUBLIC_API | Endpoint currently accepts no key; `JOBTECH_API_KEY` supported | 8h cache; 100/page; configured 2 pages/query with pacing | Official Swedish public-employment source. Search API is used for bounded keyword searches, never bulk mirroring. |

## Ready after credentials

| Source | Classification | Auth | Environment | Notes |
| --- | --- | --- | --- | --- |
| Adzuna | AUTHENTICATED_API | `app_id` + `app_key` | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Disabled by default. Configured for GB, Germany, Netherlands and France. Public display must include “Jobs by Adzuna” attribution/link. |

## Existing providers reused, not modified

The main Career-Ops lane already supports Himalayas, Jobicy, Arbeitnow,
Remotive, RemoteOK, Landing.jobs, The Muse, Working Nomads, We Work Remotely,
The Hub, Welcome to the Jungle, Germany's Arbeitsagentur, Job Bank Canada, and
direct Greenhouse, Lever, Ashby, Personio, SmartRecruiters, Recruitee,
Workable, Workday, Teamtailor, Comeet, JOIN, Breezy HR, Pinpoint and BambooHR
sources. This change does not alter those adapters or the existing user portal
configuration.

## Intentionally deferred

- Jooble, Careerjet, Reed and USAJOBS: authenticated/quota or publisher APIs;
  not enabled in this Europe-first lane.
- LinkedIn, Indeed, StepStone, local country boards and employer career pages:
  SEARCH_ONLY unless an existing public structured adapter is already present.
- Teamtailor private API: not used for arbitrary employers; the existing public
  RSS adapter remains the correct discovery route.
- EURES: MANUAL_REFERENCE_ONLY. Automated extraction is not implemented.
- Dice and Glassdoor: UNSUPPORTED for automated extraction because usable access
  would require bot-evasion; search fallback only.

## Eligibility and match safety

`discovery/eligibility.mjs` distinguishes worldwide, EMEA, Europe, EU/EEA,
Poland, country-only, timezone-restricted, and India-only cases. “Remote” alone
does not imply Poland eligibility. The report reuses `server/jobMatch.mjs`, so
React Native/mobile and mandatory backend-heavy roles cannot become Best Match
through simple React keyword overlap.
