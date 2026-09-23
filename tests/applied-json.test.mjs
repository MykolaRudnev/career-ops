import test from "node:test";
import assert from "node:assert/strict";
import { appliedJobsJson } from "../ui/src/api.ts";

test("JSON export contains only applied jobs as flat rows and preserves text", () => {
  const job = { company: 'Acme "Labs"', title: "Frontend", url: "https://example.test/job", status: "applied", notes: "Line 1\nLine 2" };
  const rows = JSON.parse(appliedJobsJson([
    job,
    { ...job, status: "pending" },
    { ...job, status: "reviewed" },
    { ...job, status: "skipped" },
    { ...job, company: "Other", date: "2026-09-16", bid: "250 PLN/h" },
  ]));
  assert.deepEqual(rows, [
    { company: job.company, title: job.title, url: job.url, location: "", date: "", status: "applied", bid: "", source: "", notes: job.notes },
    { company: "Other", title: job.title, url: job.url, location: "", date: "2026-09-16", status: "applied", bid: "250 PLN/h", source: "", notes: job.notes },
  ]);
  assert.equal(appliedJobsJson([]), "[]");
});
