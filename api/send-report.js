// Envoie le relevé d'heures à l'employeur, via Resend (https://resend.com).
// Variables à définir dans Vercel → Settings → Environment Variables :
//   RESEND_API_KEY  la clé API Resend
//   MAIL_FROM       l'expéditeur, ex. "Fin de chantier <releve@findechantier.fr>" (domaine vérifié chez Resend)
// Sans ces variables, la fonction répond 503 et l'app propose d'envoyer depuis la boîte mail du téléphone.

const MAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;
const hits = new Map(); // limite simple par adresse IP (par instance)

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function table(v, cols, maxRows) {
  if (!Array.isArray(v)) return null;
  return v.slice(0, maxRows).map((r) => (Array.isArray(r) ? r : []).slice(0, cols).map((c) => str(c, 80)));
}

function buildHtml(r) {
  const td = 'padding:6px 10px;border-bottom:1px dashed #ddd;font-size:14px';
  const head = ['Jour', '', 'Heures', 'Sup', 'Note'].map((h) => `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #111;font-size:13px">${h}</th>`).join('');
  const rows = r.rows.map((x) => `<tr>${x.map((c) => `<td style="${td}">${esc(c)}</td>`).join('')}</tr>`).join('');
  const tot = r.totals.map((x) => `<tr><td style="${td}">${esc(x[0])}</td><td style="${td};text-align:right;font-weight:700">${esc(x[1])}</td></tr>`).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:620px">
<p style="margin:0 0 4px;font-size:13px;color:#555">Relevé d'heures de <b>${esc(r.name)}</b></p>
<h2 style="margin:0 0 16px;font-size:20px">${esc(r.title)}</h2>
${r.rows.length ? `<table style="border-collapse:collapse;width:100%;margin-bottom:18px"><tr>${head}</tr>${rows}</table>` : ''}
<table style="border-collapse:collapse;width:100%;max-width:360px">${tot}</table>
<p style="margin:20px 0 0;font-size:12px;color:#777">Relevé tenu par le salarié et envoyé avec Fin de chantier (fin-de-chantier.vercel.app).</p>
</div>`;
}
function buildText(r) {
  const rows = r.rows.map((x) => `${x[0]} : ${x[1]}${x[2] ? ' ' + x[2] : ''}${x[3] ? ' + ' + x[3] + ' sup' : ''}${x[4] ? ' (' + x[4] + ')' : ''}`);
  return `${r.title}\nRelevé d'heures de ${r.name}\n\n${rows.join('\n')}\n\n${r.totals.map((x) => x[0] + ' : ' + x[1]).join('\n')}\n\nEnvoyé avec Fin de chantier`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) return res.status(503).json({ error: 'not_configured' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const now = Date.now(), recent = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= 10) return res.status(429).json({ error: 'Trop d\'envois, réessayez dans une heure.' });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const to = str(b.to, 120).trim(), cc = str(b.cc, 120).trim();
  const r = { name: str(b.name, 60) || 'Votre salarié', title: str(b.title, 120), rows: table(b.rows, 5, 40), totals: table(b.totals, 2, 12) };
  if (!MAIL.test(to) || (cc && !MAIL.test(cc)) || !r.title || !r.rows || !r.totals) return res.status(400).json({ error: 'Relevé ou adresse e-mail incorrecte.' });

  recent.push(now); hits.set(ip, recent);
  const payload = { from, to: [to], subject: r.title + ' · ' + r.name, html: buildHtml(r), text: buildText(r) };
  if (cc) { payload.cc = [cc]; payload.reply_to = cc; }

  try {
    const out = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!out.ok) {
      console.error('Resend', out.status, await out.text());
      return res.status(502).json({ error: 'Le service e-mail a refusé l\'envoi.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'Le service e-mail ne répond pas.' });
  }
};
