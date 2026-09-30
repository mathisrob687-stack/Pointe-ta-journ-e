// Lit une fiche de paie (photo ou PDF) avec Claude et renvoie les chiffres utiles.
// L'app les compare ensuite avec les heures notées par le salarié.
// Variable à définir dans Vercel → Settings → Environment Variables :
//   ANTHROPIC_API_KEY  la clé API Anthropic (la même que pour la lecture des heures)
// Sans cette variable, la fonction répond 503 et l'app explique que la lecture arrive bientôt.

const Anthropic = require('@anthropic-ai/sdk');

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const MAX_B64 = 4 * 1024 * 1024; // Vercel limite le corps de requête à 4,5 Mo
const hits = new Map(); // limite simple par adresse IP (par instance)

const num = (d) => ({ type: 'number', description: d });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'month', 'rate', 'baseHours', 'sup10', 'sup25', 'sup50', 'paniers', 'panierAmount', 'brut', 'netAvantImpot', 'netAPayer', 'cpAcquis', 'cpPris', 'remark'],
  properties: {
    readable: { type: 'boolean', description: 'false si le document n\'est pas une fiche de paie lisible' },
    month: { type: 'string', description: 'Mois de la période de paie, AAAA-MM. Vide si introuvable.' },
    rate: num('Taux horaire brut de base en euros. 0 si introuvable.'),
    baseHours: num('Heures de la ligne salaire de base (ex. 151,67). 0 si introuvable.'),
    sup10: num('Heures complémentaires ou sup payées à +10 %. 0 si aucune.'),
    sup25: num('Total des heures sup payées à +25 %, toutes lignes additionnées (y compris celles d\'un contrat 39 h). 0 si aucune.'),
    sup50: num('Total des heures sup payées à +50 %. 0 si aucune.'),
    paniers: num('Nombre de paniers ou indemnités de repas payés. 0 si aucun.'),
    panierAmount: num('Montant d\'un panier en euros. 0 si aucun.'),
    brut: num('Salaire brut total. 0 si introuvable.'),
    netAvantImpot: num('Net à payer avant impôt sur le revenu. 0 si introuvable.'),
    netAPayer: num('Net payé au salarié après impôt. 0 si introuvable.'),
    cpAcquis: num('Solde de congés payés acquis (N-1 + N) en jours. 0 si absent.'),
    cpPris: num('Congés payés pris ce mois en jours. 0 si absent.'),
    remark: { type: 'string', description: 'Une ou deux phrases courtes en français pour le salarié : ce qui est mal lisible, ou une ligne inhabituelle à regarder. Vide si rien.' },
  },
};

function prompt(today) {
  return `Tu lis la fiche de paie française d'un salarié (souvent du BTP). Aujourd'hui nous sommes le ${today}.
Relève les chiffres demandés tels qu'ils sont écrits sur la fiche, sans rien calculer toi-même sauf pour additionner plusieurs lignes d'heures sup au même taux.
- Les montants sont en euros, les heures en nombre décimal (13,50 → 13.5).
- Un chiffre absent ou illisible vaut 0. Ne rien inventer.
- Si le document n'est pas une fiche de paie, readable = false.`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'not_configured' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const now = Date.now(), recent = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= 10) return res.status(429).json({ error: 'Trop de fiches envoyées, réessayez dans une heure.' });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const type = String(b.type || ''), data = typeof b.file === 'string' ? b.file : '';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(b.today || '') ? b.today : new Date().toISOString().slice(0, 10);
  if (!TYPES.includes(type) || !data || data.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    return res.status(400).json({ error: 'Fiche manquante ou trop lourde (3 Mo maximum).' });
  }
  recent.push(now); hits.set(ip, recent);

  const doc = type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: type, data } }
    : { type: 'image', source: { type: 'base64', media_type: type, data } };

  const client = new Anthropic();
  try {
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [doc, { type: 'text', text: prompt(today) }] }],
    });
    if (msg.stop_reason === 'refusal') return res.status(422).json({ error: 'La fiche n\'a pas pu être lue.' });
    const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    let out;
    try { out = JSON.parse(text); } catch (e) { return res.status(502).json({ error: 'Lecture incomplète, réessayez.' }); }
    const n = (v, max) => Math.min(max, Math.max(0, Number(v) || 0));
    return res.status(200).json({
      readable: !!out.readable,
      month: /^\d{4}-\d{2}$/.test(out.month || '') ? out.month : '',
      rate: n(out.rate, 500), baseHours: n(out.baseHours, 400),
      sup10: n(out.sup10, 200), sup25: n(out.sup25, 200), sup50: n(out.sup50, 200),
      paniers: n(out.paniers, 62), panierAmount: n(out.panierAmount, 100),
      brut: n(out.brut, 1e5), netAvantImpot: n(out.netAvantImpot, 1e5), netAPayer: n(out.netAPayer, 1e5),
      cpAcquis: n(out.cpAcquis, 100), cpPris: n(out.cpPris, 31),
      remark: String(out.remark || '').slice(0, 300),
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'Beaucoup de demandes en ce moment, réessayez dans une minute.' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'not_configured' });
    return res.status(502).json({ error: 'Le service de lecture ne répond pas, réessayez.' });
  }
};
