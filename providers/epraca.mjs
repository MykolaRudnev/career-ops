import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const API='https://oferty.praca.gov.pl/integration/services/v2/oferta';
const tag=(xml,name)=>xml.match(new RegExp(`<(?:[\\w]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?${name}>`))?.[1] || '';
const fail=(message,code)=>{throw Object.assign(new Error(message),{code});};
export function parseEpracaJobs(rows) {
  return rows.filter(j=>/frontend|react|javascript|typescript|web developer|software|informatyk|programista|product engineer|e-commerce|magento|shopify/i.test(`${j.stanowisko} ${j.rodzajObowiazkow || ''}`)).map(j=>({
    title:j.stanowisko, sourceJobId:j.identyfikatorOferty || j.hash, url:j.link,
    company:j.nazwaPracodawcy || j.pracodawca || '', location:[j.miejscowosc,j.kraj].filter(Boolean).join(', '),
    description:j.rodzajObowiazkow || '', salary:j.wynagrodzenieBruttoZTypemStawki || j.wynagrodzenieBrutto,
    contractType:j.rodzajUmowy, postedAt:Date.parse(j.dataDodaniaOferty) || undefined, expiresAt:j.ofertaWaznaDo,
  }));
}
export default {
  id:'epraca', detect:entry=>entry.provider==='epraca' ? {url:API} : null,
  async fetch(entry,ctx) {
    const partner=process.env.EPRACA_PARTNER;
    if (!partner) fail('ePraca requires a ministry-assigned EPRACA_PARTNER; see official integrator terms','AUTH_REQUIRED');
    const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
    if (hour>=7 && hour<17) fail('ePraca service window is 17:00–07:00 Europe/Warsaw','SERVICE_WINDOW');
    const safe=partner.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
    // Namespace and SOAPAction verified against live WSDL (2026-09-15).
    const body=`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ofer="http://oferty.praca.gov.pl/v2/oferta"><soapenv:Body><ofer:Dane><pytanie><Partner>${safe}</Partner><Jezyk>pl</Jezyk><Kryterium><Wszystkie>true</Wszystkie></Kryterium></pytanie></ofer:Dane></soapenv:Body></soapenv:Envelope>`;
    const xml=await ctx.fetchText(API,{method:'POST',body,headers:{'content-type':'text/xml; charset=utf-8',SOAPAction:'http://oferty.praca.gov.pl/oferta/Dane'},redirect:'error',timeoutMs:30000});
    const status=tag(xml,'Status');
    if (status==='Brak danych') return [];
    if (/autoryzacja|adres IP/.test(status)) fail(`ePraca: ${status}`,'AUTH_REQUIRED');
    if (status!=='Poprawny') fail(`ePraca: ${status || 'unexpected SOAP response'}`,'SERVICE_ERROR');
    const base64=tag(xml,'Zawartosc');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) fail('ePraca: unexpected attachment format','API_CHANGED');
    const result=spawnSync('python3',[fileURLToPath(new URL('./_epraca-unzip.py',import.meta.url))],{input:Buffer.from(base64,'base64'),maxBuffer:64*1024*1024,timeout:30000});
    if (result.status!==0) fail('ePraca ZIP decoding failed','API_CHANGED');
    return parseEpracaJobs(JSON.parse(result.stdout.toString()));
  },
};
