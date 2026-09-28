// Lit une photo d'heures (feuille de pointage, planning, carnet, relevé de badge) avec Claude
// et renvoie les jours trouvés. L'app les montre au salarié, qui vérifie avant d'enregistrer.
// Variable à définir dans Vercel → Settings → Environment Variables :
//   ANTHROPIC_API_KEY  la clé API Anthropic (console.anthropic.com → API Keys)
// Sans cette variable, la fonction répond 503 et l'app explique que la lecture arrive bientôt.

const Anthropic = require('@anthropic-ai/sdk');

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_B64 = 4 * 1024 * 1024; // Vercel limite le corps de requête à 4,5 Mo
const hits = new Map(); // limite simple par adresse IP (par instance)

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readable', 'days', 'remark'],
  properties: {
    readable: { type: 'boolean', description: 'false si la photo ne contient pas d\'heures de travail lisibles' },
    remark: { type: 'string', description: 'Une phrase courte en français pour le salarié : ce qui est incertain ou mal lisible. Vide si tout est clair.' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'type', 'hours', 'sup', 'note', 'unsure'],
        properties: {
          date: { type: 'string', description: 'AAAA-MM-JJ' },
          type: { type: 'string', enum: ['work', 'cp', 'maladie', 'absent'] },
          hours: { type: 'number', description: 'Total d\'heures travaillées ce jour, pauses non payées déduites, heures sup comprises. 0 si pas travaillé.' },
          sup: { type: 'number', description: 'Heures sup écrites explicitement sur le document pour ce jour (comprises dans hours). 0 si rien n\'est marqué.' },
          note: { type: 'string', description: 'Chantier ou motif écrit pour ce jour, 40 caractères max, sinon vide' },
          unsure: { type: 'boolean', description: 'true si la date ou les heures de ce jour sont mal lisibles ou devinées' },
        },
      },
    },
  },
};

function prompt(today, daily) {
  return `Tu lis la photo d'un document d'heures de travail d'un salarié français (feuille de pointage, planning, carnet, relevé de badgeuse, agenda).
Aujourd'hui nous sommes le ${today}. Sa journée normale est de ${daily} h.

Relève chaque jour qui figure sur le document :
- date au format AAAA-MM-JJ. Si l'année ou le mois manquent, prends les plus probables par rapport à aujourd'hui (jamais dans le futur si le document parle d'heures faites).
- type : work (travaillé), cp (congé payé, "CP", "congés"), maladie ("arrêt", "AM", "maladie"), absent (absence, "abs").
- hours : total travaillé. Avec des horaires (ex. 7h30-12h / 13h-16h30), additionne les plages. Avec une seule plage et une pause écrite, retire la pause. Une durée écrite (ex. "8h", "7,5") se prend telle quelle.
- sup : seulement les heures sup marquées comme telles sur le document ("HS", "sup", colonne dédiée). Sinon 0 : l'app calcule elle-même au-delà de la journée normale.
- Ignore les jours vides, les totaux de semaine et les lignes qui ne sont pas des jours.
- unsure à true pour tout ce qui est deviné. Ne rien inventer : si la photo ne montre pas d'heures, readable = false et days vide.`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'not_configured' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const now = Date.now(), recent = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= 20) return res.status(429).json({ error: 'Trop de photos envoyées, réessayez dans une heure.' });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const type = String(b.type || ''), data = typeof b.image === 'string' ? b.image : '';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(b.today || '') ? b.today : new Date().toISOString().slice(0, 10);
  const daily = Math.min(12, Math.max(1, Number(b.daily) || 7));
  if (!TYPES.includes(type) || !data || data.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    return res.status(400).json({ error: 'Photo manquante ou trop lourde.' });
  }
  recent.push(now); hits.set(ip, recent);

  const client = new Anthropic();
  try {
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: type, data } },
          { type: 'text', text: prompt(today, daily) },
        ],
      }],
    });
    if (msg.stop_reason === 'refusal') return res.status(422).json({ error: 'La photo n\'a pas pu être lue.' });
    const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    let out;
    try { out = JSON.parse(text); } catch (e) { return res.status(502).json({ error: 'Lecture incomplète, réessayez.' }); }
    const days = (Array.isArray(out.days) ? out.days : []).slice(0, 62)
      .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && ['work', 'cp', 'maladie', 'absent'].includes(d.type))
      .map((d) => ({
        date: d.date,
        type: d.type,
        hours: Math.min(24, Math.max(0, Number(d.hours) || 0)),
        sup: Math.min(24, Math.max(0, Number(d.sup) || 0)),
        note: String(d.note || '').slice(0, 60),
        unsure: !!d.unsure,
      }));
    return res.status(200).json({ readable: !!out.readable && days.length > 0, days, remark: String(out.remark || '').slice(0, 300) });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'Beaucoup de demandes en ce moment, réessayez dans une minute.' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'not_configured' });
    return res.status(502).json({ error: 'Le service de lecture ne répond pas, réessayez.' });
  }
};
