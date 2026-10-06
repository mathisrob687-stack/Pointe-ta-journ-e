/* Pointe ta journée : calculs de paie partagés par la page d'accueil et l'app.
   Ce sont des estimations. Les taux réels dépendent de la convention collective. */
(function (global) {
  'use strict';

  // fin: primes versées en une fois à la fin du contrat (CDD), pas chaque mois
  var CONTRATS = {
    cdi:      { label: 'CDI',           precarite: 0,    icp: 0,    fin: false, hint: 'Contrat à durée indéterminée' },
    cdd:      { label: 'CDD',           precarite: 0.10, icp: 0.10, fin: true,  hint: '+10 % de fin de contrat et +10 % de congés, versés à la fin du contrat' },
    interim:  { label: 'Intérim',       precarite: 0.10, icp: 0.10, fin: false, hint: '+10 % de fin de mission et +10 % de congés, versés avec chaque paie' },
    apprenti: { label: 'Apprentissage', precarite: 0,    icp: 0,    fin: false, hint: 'Pas de cotisations jusqu\'à la moitié du SMIC (contrats signés depuis mars 2025)' }
  };

  // Part moyenne de cotisations salariales retenue sur le brut (mutuelle comprise)
  var STATUTS = {
    ouvrier: { label: 'Ouvrier',            cotis: 0.22 },
    etam:    { label: 'ETAM / technicien',  cotis: 0.225 },
    cadre:   { label: 'Cadre',              cotis: 0.25 }
  };

  var HS_REDUCTION = 0.1131;   // réduction de cotisations salariales sur les heures sup
  var CARENCE = 3;             // jours de carence maladie (Sécurité sociale)
  var SMIC_MOIS = 1823.03;     // SMIC brut mensuel 35 h au 1er janvier 2026
  var CSG_IJ = 0.067;          // CSG + CRDS retenues sur les indemnités journalières
  var H_MOIS = 52 / 12;        // semaines par mois

  var HOLIDAYS = [
    '2026-01-01','2026-04-06','2026-05-01','2026-05-08','2026-05-14','2026-05-25','2026-07-14','2026-08-15','2026-11-01','2026-11-11','2026-12-25',
    '2027-01-01','2027-03-29','2027-05-01','2027-05-06','2027-05-08','2027-05-17','2027-07-14','2027-08-15','2027-11-01','2027-11-11','2027-12-25'
  ];
  var HOLI = {};
  HOLIDAYS.forEach(function (d) { HOLI[d] = true; });

  function cotisRate(contrat, statut) {
    return (STATUTS[statut] || STATUTS.ouvrier).cotis;
  }

  // Dans le BTP, les congés sont payés par la caisse CIBTP (sauf en intérim)
  function caisseCP(contrat, btp) { return !!btp && contrat !== 'interim'; }

  // Heures payées chaque mois par le contrat : la base (35 h max) et les heures sup
  // comprises dans l'horaire (ex. 39 h = 4 h sup par semaine, payées +25 %)
  function contractHours(weekly) {
    var extra = Math.max(0, weekly - 35), x25 = Math.min(extra, 8);
    return { baseH: Math.min(weekly, 35) * H_MOIS, s25: x25 * H_MOIS, s50: (extra - x25) * H_MOIS };
  }
  function monthlyBase(rate, weekly) { return Math.min(weekly, 35) * H_MOIS * rate; }
  // Salaire brut mensuel du contrat, heures sup comprises dans l'horaire incluses
  function contractMonthly(rate, weekly) {
    var c = contractHours(weekly);
    return (c.baseH + c.s25 * 1.25 + c.s50 * 1.5) * rate;
  }

  /* Heures faites en plus de l'horaire du contrat, sur une semaine.
     Temps partiel : heures complémentaires +10 % jusqu'au 1/10 du contrat, puis +25 %.
     Temps plein : +25 % jusqu'à 43 h (8 h sup au total), puis +50 %. */
  function splitWeek(hours, weekly) {
    weekly = weekly == null ? 35 : +weekly;
    var b10 = weekly < 35 ? Math.min(weekly * 0.1, 35 - weekly) : 0;
    var b25 = Math.max(0, 43 - Math.max(weekly, 35)) + (weekly < 35 ? 35 - weekly - b10 : 0);
    var s10 = Math.min(hours, b10), s25 = Math.min(hours - s10, b25);
    return { s10: s10, s25: s25, s50: Math.max(0, hours - s10 - s25) };
  }
  // Même découpage pour un total d'heures sur un mois (4,33 semaines)
  function splitMonth(hours, weekly) {
    var w = splitWeek(hours / H_MOIS, weekly);
    return { s10: w.s10 * H_MOIS, s25: w.s25 * H_MOIS, s50: w.s50 * H_MOIS };
  }

  /* p = { rate, weekly, daily, contrat, statut, btp, s10, s25, s50, absH, maladieJours, cpJours, paniers, panierAmt, maj }
     maj : majorations brutes en euros (nuit, dimanche, jours fériés)
     Renvoie le détail d'une paie mensuelle estimée, jusqu'au net avant impôt. */
  function computePay(p) {
    var rate = +p.rate || 0, weekly = +p.weekly || 35, daily = +p.daily || weekly / 5;
    var c = CONTRATS[p.contrat] || CONTRATS.cdi;
    var ch = contractHours(weekly);
    var base = ch.baseH * rate;
    var hsContratH = ch.s25 + ch.s50;
    var hsContrat = (ch.s25 * 1.25 + ch.s50 * 1.5) * rate;
    var hs = ((+p.s10 || 0) * 1.10 + (+p.s25 || 0) * 1.25 + (+p.s50 || 0) * 1.5) * rate;
    var maj = +p.maj || 0;
    var abs = (+p.absH || 0) * rate;
    var malJ = +p.maladieJours || 0;
    var mal = malJ * daily * rate;
    // Congés BTP : l'employeur retire les jours posés, la caisse CIBTP les paie à part
    var caisse = caisseCP(p.contrat, p.btp);
    var cpJ = +p.cpJours || 0;
    var cpRetenue = caisse ? cpJ * daily * rate : 0;
    var sub = Math.max(0, base + hsContrat + hs + maj - abs - mal - cpRetenue);
    var icpRate = caisse ? 0 : c.icp;
    var precarite = sub * c.precarite;
    var icp = (sub + precarite) * icpRate;
    // CDD : les deux primes sont gardées pour la fin du contrat
    var finContrat = c.fin ? precarite + icp : 0;
    if (c.fin) { precarite = 0; icp = 0; }
    var brut = sub + precarite + icp;
    var cr = cotisRate(p.contrat, p.statut);
    var hsPart = Math.min(hsContrat + hs, brut);
    var cotis;
    if (p.contrat === 'apprenti') {
      // Apprenti : cotisations seulement sur la part au-dessus de la moitié du SMIC
      var assiette = Math.max(0, brut - SMIC_MOIS * 0.5);
      cotis = assiette * cr - Math.min(hsPart, assiette) * HS_REDUCTION;
    } else {
      cotis = (brut - hsPart) * cr + hsPart * (cr - HS_REDUCTION);
    }
    cotis = Math.max(0, cotis);
    // Indemnités Sécu : jours calendaires (un arrêt du lundi au vendredi dure 7 jours),
    // 50 % du salaire journalier plafonné à 1,4 SMIC, moins CSG et CRDS
    var ijJours = malJ ? Math.max(0, Math.round(malJ * 7 / 5) - CARENCE) : 0;
    var sjb = Math.min(base + hsContrat, SMIC_MOIS * 1.4) * 3 / 91.25;
    var ijss = ijJours * 0.5 * sjb * (1 - CSG_IJ);
    var paniers = (+p.paniers || 0) * (+p.panierAmt || 0);
    var net = brut - cotis + paniers + ijss;
    return {
      base: base, baseH: ch.baseH, hsContrat: hsContrat, hsContratH: hsContratH,
      hs: hs, maj: maj, abs: abs, mal: mal, cpRetenue: cpRetenue, caisse: caisse, ijss: ijss, ijJours: ijJours,
      precarite: precarite, icp: icp, finContrat: finContrat,
      brut: brut, cotis: cotis, cotisRate: brut > 0 ? cotis / brut : 0, paniers: paniers, net: net
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
    var maintien = contractMonthly(rate, weekly) / 26;
    var dixieme = brutPeriode > 0 ? brutPeriode * 0.10 / 30 : 0;
    return { maintien: maintien, dixieme: dixieme, best: Math.max(maintien, dixieme) };
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2], 12); }

  var eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  var eur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Durée affichée en heures et minutes : 0.5 → "00h30", 136 → "136h00"
  function hours(h) {
    var m = Math.round(Math.abs(h || 0) * 60), H = Math.floor(m / 60), M = m % 60;
    return (h < 0 && m ? '−' : '') + (H < 10 ? '0' : '') + H + 'h' + (M < 10 ? '0' : '') + M;
  }
  // Lit "7h30", "7:30", "7,5" ou "7" et arrondit au quart d'heure
  function parseHours(v) {
    var t = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ''), x;
    var m = t.match(/^(\d{1,2})[h:](\d{0,2})$/);
    if (m) x = Number(m[1]) + (Number(m[2] || 0)) / 60; else x = parseFloat(t.replace(',', '.'));
    return isNaN(x) ? NaN : quarter(x);
  }
  function quarter(h) { return Math.max(0, Math.round(h * 4) / 4); }

  var store = {
    get: function (k, fallback) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  global.FDC = {
    CONTRATS: CONTRATS, STATUTS: STATUTS, HOLI: HOLI,
    cotisRate: cotisRate, caisseCP: caisseCP, contractHours: contractHours, monthlyBase: monthlyBase, contractMonthly: contractMonthly,
    splitWeek: splitWeek, splitMonth: splitMonth, computePay: computePay, SMIC_MOIS: SMIC_MOIS,
    cpPeriodStart: cpPeriodStart, cpAcquired: cpAcquired, cpDayValue: cpDayValue,
    iso: iso, parse: parse, eur0: eur0, eur2: eur2, hours: hours, parseHours: parseHours, quarter: quarter, store: store,
    MONTHS: ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  };
})(window);
