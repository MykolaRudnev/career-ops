#!/usr/bin/env node
// Discovery only: writes provider caches/health and a report, never the tracker or applications.
import { discoveryReport } from './discovery/report.mjs';
await discoveryReport();
