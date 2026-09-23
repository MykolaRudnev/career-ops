import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { loadParsedMasterCv, buildSimpleTailorResult } from '../server/cvFromMaster.mjs';
import { renderAndValidateTailoredCv } from '../server/aiTailor.ts';

// Uses canonical candidate data and the production renderer; no LLM calls.
// Retain generated regression PDFs for layout review under outputs/.
test('React, Magento/Hyva and Shopify PDFs retain all canonical courses in two pages', async () => {
  const courses = loadParsedMasterCv().certifications;
  const expectedTitles = ['Frontend System Design Essentials', 'Cursor & Claude Code Professional AI Setup', 'Next.js From Scratch 2024', 'React Hooks -- Building Real Project From Scratch', 'Understanding TypeScript', 'ReactJS from Scratch to Pro'];
  for (const title of expectedTitles) assert.ok(courses.some(course => course.title === title), `Canonical course missing: ${title}`);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [role, jd] of [
      ['Senior React Developer', 'React, Next.js, TypeScript frontend applications.'],
      ['Magento / Hyva Developer', 'Magento 2 and Hyva storefront development.'],
      ['Shopify Developer', 'Shopify Liquid themes and custom sections.']
    ]) {
      const job = { id: `professional-development-${role}`, company: 'Professional Development Regression', title: role, url: `https://example.test/professional-development/${encodeURIComponent(role)}` };
      const result = buildSimpleTailorResult({ ...job, extra: jd });
      // Even an untrusted model result trying to remove courses cannot override history.
      result.certifications = [];
      const artifact = await renderAndValidateTailoredCv(job, jd, result);
      assert.equal(artifact.metadata.pages, 2, `${role}: page count`);
      const page = await browser.newPage();
      try {
        await page.goto(`file://${artifact.htmlPath}`);
        const rendered = await page.locator('.cert-item').evaluateAll(rows => rows.map(row => ({
          title: row.querySelector('.cert-title').textContent.trim(),
          org: row.querySelector('.cert-org').textContent.trim(),
          year: row.querySelector('.cert-year').textContent.trim()
        })));
        assert.deepEqual(rendered, courses, `${role}: titles/providers/dates/order must equal cv.md`);
      } finally { await page.close(); }
      const extracted = execFileSync('pdftotext', ['-layout', artifact.pdfPath, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
      const markdown = fs.readFileSync(artifact.markdownPath, 'utf8');
      let previous = -1;
      for (const course of courses) {
        const position = extracted.indexOf(course.title);
        assert.ok(position > previous, `${role}: missing or reordered PDF course ${course.title}`);
        previous = position;
        assert.ok(extracted.includes(course.year));
        if (course.org) assert.ok(extracted.includes(course.org));
        assert.ok(markdown.includes(course.title));
      }
      console.log(`${role}: ${courses.length} canonical courses, ${artifact.metadata.pages} pages — ${artifact.pdfPath}`);
    }
  } finally { await browser.close(); }
});
