// Bildetolking med Claude (Anthropic API). Krever nett og egen API-nøkkel.
// Nøkkelen lagres bare på denne enheten og sendes kun direkte til api.anthropic.com.

import Anthropic from '../vendor/anthropic.mjs';
import { blobToDataURL } from './util.js';

export const MODELS = {
  'claude-opus-5-5': 'Claude Opus 5.5 (mest nøyaktig, standard)',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (raskere, billigere)',
  'claude-haiku-5-5': 'Claude Haiku 5.5 (raskest, billigst)',
};
export const DEFAULT_MODEL = 'claude-opus-5-5';

const FIELDS = ['name', 'category', 'quantity', 'brand', 'model'];

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Kort norsk navn, f.eks. «Gjæresag» eller «Vater 60 cm»' },
          category: { type: 'string', description: 'Norsk kategori, f.eks. Elektroverktøy, Håndverktøy, Måleverktøy, Festemidler, Forbruksvarer' },
          quantity: { type: 'integer', description: 'Antall synlige eksemplarer' },
          unit: { type: 'string', description: 'Enhet, normalt «stk»' },
          tracking: { type: 'string', enum: ['enkelt', 'mengde'], description: 'enkelt = spores individuelt (drill, sag). mengde = telles (bits, skruer, spiker)' },
          brand: { type: 'string', description: 'Merke bare hvis det er tydelig lesbart på bildet, ellers tom streng' },
          model: { type: 'string', description: 'Modell/modellnummer bare hvis det er tydelig lesbart, ellers tom streng. Aldri gjett.' },
          uncertain: { type: 'array', items: { type: 'string', enum: FIELDS }, description: 'Felter du er usikker på' },
          note: { type: 'string', description: 'Kort begrunnelse for usikkerhet, eller tom streng' },
        },
        required: ['name', 'category', 'quantity', 'unit', 'tracking', 'brand', 'model', 'uncertain', 'note'],
        additionalProperties: false,
      },
    },
    image_note: { type: 'string', description: 'Kort merknad om bildet, f.eks. at deler av kassen er skjult. Tom streng hvis ingen.' },
  },
  required: ['items', 'image_note'],
  additionalProperties: false,
};

const SYSTEM = `Du hjelper en håndverker med å registrere verktøy og utstyr fra bilder i en norsk app.
Regler:
- List bare gjenstander som faktisk er synlige i bildet. Ikke anta at noe ligger skjult i kasser, skuffer eller under andre ting.
- Oppgi merke og modell bare når teksten er tydelig lesbar i bildet. Ikke gjett modellnummer ut fra utseende; la feltet være tomt.
- Marker felter du er usikker på i «uncertain», og forklar kort i «note».
- Bruk norske navn og kategorier. Bruk «mengde» for småting som telles (bits, skruer, spiker, blad), ellers «enkelt».
- Like enkeltverktøy kan slås sammen med antall, men bare hvis de ser helt like ut.
- Svar på norsk.`;

// På claude.ai (Artifact) kan bildetolkingen gå via innlogget Claude-konto, uten egen API-nøkkel.
export const samplerReady = (async () => {
  try {
    if (!window.claude?.use) return null;
    const s = await window.claude.use('sample');
    if (!s) return null;
    const lim = await s.limits().catch(() => null);
    return lim?.images ? s : null;
  } catch { return null; }
})();
let sampler = null;
samplerReady.then((s) => (sampler = s));
export const hasBuiltInAI = () => !!sampler;

function normalize(parsed) {
  return {
    note: parsed.image_note || '',
    items: (parsed.items || []).map((x) => ({
      include: true,
      name: x.name || '',
      category: x.category || '',
      qty: Math.max(1, Number(x.quantity) || 1),
      unit: x.unit || 'stk',
      type: x.tracking === 'mengde' ? 'mengde' : 'enkelt',
      brand: x.brand || '',
      model: x.model || '',
      uncertain: (x.uncertain || []).map((f) => (f === 'quantity' ? 'qty' : f)),
      note: x.note || '',
    })),
  };
}

async function analyzeWithSampler(blob, hint) {
  const prompt = `${SYSTEM}\n\nBildet som følger er tatt av brukeren. Hvilke verktøy og hvilket utstyr er synlig?${hint ? ' Brukerens merknad: ' + hint : ''}\nSvar KUN med JSON etter dette skjemaet: ${JSON.stringify(SCHEMA)}`;
  try {
    return normalize(await sampler.json(prompt, { images: [blob], modelTier: 'complex', cache: false }));
  } catch (e) {
    if (e?.code === 'not_granted') throw new Error('Du må tillate at siden bruker Claude for å tolke bilder.');
    if (e?.code === 'rate_limited') throw new Error('For mange forespørsler. Vent litt og prøv igjen.');
    throw new Error(`Bildetolking feilet: ${e?.message || e}`);
  }
}

export async function analyzeImage(blob, { apiKey, model = DEFAULT_MODEL, hint = '' }) {
  if (!navigator.onLine) throw new Error('Du er uten nett. Bildetolking krever internett.');
  if (!apiKey && sampler) return analyzeWithSampler(blob, hint);
  if (!apiKey) throw new Error('Mangler API-nøkkel. Legg den inn under Mer → Innstillinger.');
  const dataUrl = await blobToDataURL(blob);
  const [head, data] = dataUrl.split(',');
  const media_type = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type, data } },
        { type: 'text', text: `Hvilke verktøy og hvilket utstyr er synlig i bildet?${hint ? ' Brukerens merknad: ' + hint : ''}` },
      ],
    }],
  };
  let res;
  try {
    // Ved avslag fra sikkerhetsfilteret prøver API-et automatisk en annen modell.
    res = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('API-nøkkelen ble avvist. Sjekk at den er riktig.');
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error('API-nøkkelen har ikke tilgang til denne modellen.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('For mange forespørsler eller tomt for kreditt. Prøv igjen senere.');
    if (err instanceof Anthropic.BadRequestError) {
      // Prøv én gang uten reservemodell-parameteren i tilfelle kontoen ikke har tilgang til den.
      try { res = await client.messages.create(params); } catch (e2) { throw new Error(`Bildetolking feilet: ${e2.message}`); }
    } else if (err instanceof Anthropic.APIConnectionError) {
      throw new Error('Fikk ikke kontakt med bildetolkingstjenesten. Sjekk nettet.');
    } else throw new Error(`Bildetolking feilet: ${err.message}`);
  }
  if (res.stop_reason === 'refusal') throw new Error('Tjenesten ville ikke tolke dette bildet. Registrer manuelt.');
  if (res.stop_reason === 'max_tokens') throw new Error('Svaret ble for langt. Prøv et bilde med færre gjenstander.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Kunne ikke lese svaret fra bildetolkingen.'); }
  return normalize(parsed);
}
