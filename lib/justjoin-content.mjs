// Runs in page.evaluate. Only the offer identified by the current URL supplies
// structured fields; company profiles and recommendation trees are not JD.
export function readJustJoinContent(expectedUrl) {
  const canonical = value => {
    try { const u = new URL(value, location.href); return u.origin + u.pathname.replace(/\/$/, ''); }
    catch { return ''; }
  };
  const url = canonical(expectedUrl);
  if (canonical(location.href) !== url) return { text: '', source: 'identity-mismatch' };
  const slug = new URL(url).pathname.split('/').at(-1);
  const heading = document.querySelector('h1')?.textContent.trim();
  const plain = html => {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script,style,nav,aside,footer').forEach(el => el.remove());
    doc.querySelectorAll('p,li,div,h1,h2,h3,h4,br').forEach(el => el.append('\n'));
    return doc.body.textContent.trim();
  };
  // Hydration may consume __next_f; the serialized script data remains available.
  const serialized = [...document.scripts].flatMap(script => {
    const match = script.textContent.match(/self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?\s*$/);
    try { return match ? [JSON.parse(match[1])] : []; } catch { return []; }
  });
  const flight = (serialized.length ? serialized : globalThis.__next_f || [])
    .filter(row => row[0] === 1 && typeof row[1] === 'string').map(row => row[1]).join('');
  const resolveText = value => {
    if (typeof value !== 'string') return '';
    if (!/^\$[\da-f]+$/i.test(value)) return value;
    const match = flight.match(new RegExp(`(?:^|\\n)${value.slice(1)}:T([\\da-f]+),`, 'i'));
    if (!match) return '';
    return new TextDecoder().decode(new TextEncoder().encode(flight.slice(match.index + match[0].length)).slice(0, parseInt(match[1], 16)));
  };
  let offer;
  const visit = value => {
    if (!value || typeof value !== 'object' || offer) return;
    if (value.slug === slug && typeof value.title === 'string' && value.body && Array.isArray(value.requiredSkills)) { offer = value; return; }
    Object.values(value).forEach(visit);
  };
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    try { visit(JSON.parse(script.textContent)); } catch { /* not job data */ }
  }
  for (const line of flight.split('\n')) {
    try { visit(JSON.parse(line.slice(line.indexOf(':') + 1))); } catch { /* non-JSON Flight record */ }
  }
  const section = name => {
    const headings = [...document.querySelectorAll('h2,h3')].filter(el => el.textContent.trim().toLowerCase() === name);
    if (headings.length !== 1 || headings[0].closest('aside,nav,footer')) return null;
    return headings[0];
  };
  const stack = section('tech stack')?.nextElementSibling;
  const domStack = stack ? [...stack.querySelectorAll('h4')].map(el => {
    const level = el.parentElement.querySelector('span')?.textContent.trim() || '';
    return `${/nice to have/i.test(level) ? 'Preferred' : 'Required'}: ${el.textContent.trim()} ${level}`;
  }).join('\n') : '';
  const structuredStack = offer ? [
    ...(offer.requiredSkills || []).map(s => `${s.level === 1 ? 'Preferred' : 'Required'}: ${s.name}`),
    ...(offer.niceToHaveSkills || []).map(s => `Preferred: ${s.name}`),
    ...(offer.languages || []).map(l => `Required: ${l.code === 'en' ? 'English' : l.code} ${l.level}`)
  ].join('\n') : '';
  const result = (title, body, source) => {
    const domBody = section('job description')?.nextElementSibling;
    // JSON-LD sometimes flattens paragraphs. Restore only identical text from
    // the current description container, never append unrelated DOM content.
    if (domBody && plain(domBody.innerHTML).replace(/\s/g, '') === plain(body).replace(/\s/g, '')) body = domBody.innerHTML;
    return { title, text: `${title}\n${plain(body)}\n${structuredStack || domStack}`.trim(), source };
  };
  const body = resolveText(offer?.body);
  if (body) return result(offer.title, body, 'current-offer-data');
  const postings = [];
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    if ([value['@type']].flat().includes('JobPosting')) postings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value['@graph']) collect(value['@graph']);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { collect(JSON.parse(script.textContent)); } catch { /* malformed JSON-LD */ }
  }
  const posting = postings.find(p => p.url && canonical(p.url) === url)
    || (postings.length === 1 && !postings[0].url && postings[0].title === heading ? postings[0] : null);
  if (posting?.description) return result(posting.title, posting.description, 'current-jobposting');
  const description = section('job description')?.nextElementSibling;
  if (description && heading && !description.querySelector('h1,h2,h3,a[href*="/job-offer/"]')) {
    return result(heading, description.innerHTML, 'current-description-container');
  }
  // Fail closed: a missing vacancy container must never turn the page into a JD.
  return { title: heading || '', text: '', source: 'current-job-not-found' };
}
