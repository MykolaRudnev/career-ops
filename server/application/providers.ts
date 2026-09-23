// Provider differences stay here; standard HTML controls share the existing DOM extractor.
const definitions = [
  { id: 'JustJoinIT', hosts: ['justjoin.it'], apply: /^(apply|apply now|aplikuj|aplikuj teraz)$/i, submit: /^(send application|submit application|apply|aplikuj|wyślij aplikację)$/i },
  { id: 'Greenhouse', hosts: ['greenhouse.io', 'greenhouse.io.eu'], apply: /^(apply|apply now|apply for this job)$/i, submit: /^(submit application|submit|apply)$/i },
  { id: 'Lever', hosts: ['lever.co'], apply: /^(apply for this job|apply now|apply)$/i, submit: /^(submit application|submit)$/i },
  { id: 'Ashby', hosts: ['ashbyhq.com'], apply: /^(apply|apply now|apply for this job)$/i, submit: /^(submit application|submit)$/i },
  { id: 'Workable', hosts: ['workable.com'], apply: /^(apply|apply now|apply for this job)$/i, submit: /^(submit application|submit|apply)$/i },
  { id: 'Teamtailor', hosts: ['teamtailor.com'], apply: /^(apply|apply now|apply for this job)$/i, submit: /^(submit application|send application|submit)$/i },
];
const generic = { id: 'Generic', hosts: [], apply: /^(apply|apply now|apply for this job|aplikuj|aplikuj teraz)$/i, submit: /^(submit application|send application|wyślij aplikację)$/i };
export function detectProvider(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith('.myworkdayjobs.com') || host.endsWith('.myworkdaysite.com')) return { ...generic, id: 'Unsupported' };
  return definitions.find(d => d.hosts.some(h => host === h || host.endsWith(`.${h}`))) || generic;
}
export async function submitControl(frame: any, provider: any) {
  const controls = frame.getByRole('button', { name: provider.submit });
  const visible = [];
  for (const control of await controls.all()) if (await control.isVisible() && await control.isEnabled()) visible.push(control);
  return visible.length === 1 ? visible[0] : null;
}
export const successText = /application (?:has been |was )?(?:successfully )?(?:submitted|received)|thank you for applying|thanks for applying|dziękujemy za (?:aplikację|aplikowanie)|aplikacja została wysłana/i;
export async function verifySuccess(page: any, frame: any, before: string) {
  if (successText.test(before)) return null; // Pre-existing confirmation never proves this attempt.
  const deadline = Date.now() + 12000;
  do {
    for (const target of [page, frame]) {
      const text = await target.locator('body').innerText({ timeout: 1000 }).catch(() => '');
      const found = text.match(successText);
      if (found) return found[0];
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return null;
}

export async function prepareProvider(page: any) {
  const reject = page.getByRole('button', { name: /^(decline all|reject all|odrzuć wszystkie)$/i });
  if (await reject.count() && await reject.first().isVisible()) {
    await reject.first().click();
    await reject.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  if (detectProvider(page.url()).id === 'JustJoinIT') {
    // Close only the optional sign-up promotion, never a required login form.
    if (await page.getByText('Create an account and search smarter', { exact: true }).isVisible().catch(() => false)) {
      const close = page.getByRole('button', { name: 'Close', exact: true });
      if (await close.count() === 1 && await close.isVisible()) await close.click();
    }
  }
}
