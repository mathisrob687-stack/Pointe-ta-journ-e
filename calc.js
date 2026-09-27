/* Fin de chantier : calculs de paie partagés par la page d'accueil et l'app.
   Ce sont des estimations. Les taux réels dépendent de la convention collective. */
(function (global) {
  'use strict';

  var CONTRATS = {
    cdi:      { label: 'CDI',           precarite: 0,    icp: 0,    hint: 'Contrat à durée indéterminée' },
    cdd:      { label: 'CDD',           precarite: 0.10, icp: 0.10, hint: '+10 % de fin de contrat et +10 % de congés payés' },
    interim:  { label: 'Intérim',       precarite: 0.10, icp: 0.10, hint: '+10 % de fin de mission et +10 % de congés payés' },
    apprenti: { label: 'Apprentissage', precarite: 0,    icp: 0,    hint: 'Presque pas de cotisations sur le salaire' }
  };

  // Part moyenne de cotisations salariales retenue sur le brut
  var STATUTS = {
    ouvrier: { label: 'Ouvrier',            cotis: 0.22 },
    etam:    { label: 'ETAM / technicien',  cotis: 0.225 },
    cadre:   { label: 'Cadre',              cotis: 0.25 }
  };

  var HS_REDUCTION = 0.1131;   // réduction de cotisations salariales sur les heures sup
  var CARENCE = 3;             // jours de carence maladie (Sécurité sociale)

  var HOLIDAYS = [
    '2026-01-01','2026-04-06','2026-05-01','2026-05-08','2026-05-14','2026-05-25','2026-07-14','2026-08-15','2026-11-01','2026-11-11','2026-12-25',
    '2027-01-01','2027-03-29','2027-05-01','2027-05-06','2027-05-08','2027-05-17','2027-07-14','2027-08-15','2027-11-01','2027-11-11','2027-12-25'
  ];
  var HOLI = {};
  HOLIDAYS.forEach(function (d) { HOLI[d] = true; });

  function cotisRate(contrat, statut) {
    if (contrat === 'apprenti') return 0;
    return (STATUTS[statut] || STATUTS.ouvrier).cotis;
  }

  function monthlyBase(rate, weekly) { return weekly * 52 / 12 * rate; }

  // Heures sup d'une semaine : les 8 premières à +25 %, les suivantes à +50 %
  function splitWeek(hours) {
    var s25 = Math.min(hours, 8);
    return { s25: s25, s50: Math.max(0, hours - s25) };
  }

  /* p = { rate, weekly, daily, contrat, statut, s25, s50, absH, maladieJours, paniers, panierAmt }
     Renvoie le détail d'une paie mensuelle estimée. */
  function computePay(p) {
    var rate = +p.rate || 0, weekly = +p.weekly || 35, daily = +p.daily || weekly / 5;
    var c = CONTRATS[p.contrat] || CONTRATS.cdi;
    var base = monthlyBase(rate, weekly);
    var hs = ((+p.s25 || 0) * 1.25 + (+p.s50 || 0) * 1.5) * rate;
    var abs = (+p.absH || 0) * rate;
    var malJ = +p.maladieJours || 0;
    var mal = malJ * daily * rate;
    var ijss = Math.max(0, malJ - CARENCE) * 0.5 * (base * 3 / 91.25);
    var sub = Math.max(0, base + hs - abs - mal);
    var precarite = sub * c.precarite;
    var icp = (sub + precarite) * c.icp;
    var brut = sub + precarite + icp;
    var cr = cotisRate(p.contrat, p.statut);
    var hsPart = Math.min(hs, brut);
    var cotis = (brut - hsPart) * cr + hsPart * Math.max(0, cr - HS_REDUCTION);
    var paniers = (+p.paniers || 0) * (+p.panierAmt || 0);
    var net = brut - cotis + paniers + ijss;
    return {
      base: base, hs: hs, abs: abs, mal: mal, ijss: ijss, precarite: precarite, icp: icp,
      brut: brut, cotis: cotis, cotisRate: cr, paniers: paniers, net: net
    };
  }

  // Période de référence des congés : 1er juin → 31 mai
  function cpPeriodStart(today) {
    var y = today.getMonth() >= 5 ? today.getFullYear() : today.getFullYear() - 1;
    return new Date(y, 5, 1, 12);
  }

  // 2,5 jours ouvrables par mois travaillé, 30 jours maximum par période
  function cpAcquired(startDate, today) {
    var from = cpPeriodStart(today);
    if (startDate && startDate > from) from = startDate;
    if (from > today) return { months: 0, days: 0, from: from };
    // mois entiers déjà terminés depuis le début de la période
    var months = (today.getFullYear() - from.getFullYear()) * 12 + (today.getMonth() - from.getMonth());
    if (today.getDate() < from.getDate()) months -= 1;
    months = Math.max(0, Math.min(12, months));
    var days = Math.min(30, Math.round(months * 2.5 * 2) / 2);
    return { months: months, days: days, from: from };
  }

  // Valeur d'un jour de congé : on garde la plus avantageuse des deux règles
  function cpDayValue(rate, weekly, brutPeriode) {
    var maintien = monthlyBase(rate, weekly) / 26;
    var dixieme = brutPeriode > 0 ? brutPeriode * 0.10 / 30 : 0;
    return { maintien: maintien, dixieme: dixieme, best: Math.max(maintien, dixieme) };
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2], 12); }

  var eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  var eur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function hours(h) { return (Math.round(h * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' h'; }

  var store = {
    get: function (k, fallback) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  global.FDC = {
    CONTRATS: CONTRATS, STATUTS: STATUTS, HOLI: HOLI,
    cotisRate: cotisRate, monthlyBase: monthlyBase, splitWeek: splitWeek, computePay: computePay,
    cpPeriodStart: cpPeriodStart, cpAcquired: cpAcquired, cpDayValue: cpDayValue,
    iso: iso, parse: parse, eur0: eur0, eur2: eur2, hours: hours, store: store,
    MONTHS: ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  };
})(window);
