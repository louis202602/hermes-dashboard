import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isHumanCertified,
  pvAzimuthLabel,
  pvBadge,
  pvProspectName,
  pvToneClass,
} from "@/lib/pv/status";
import { grantedModules, isActionAllowed, moduleDef } from "@/lib/verticals/modules";
import { resolveVertical } from "@/lib/verticals/manifest";
import { isRouteAllowed, resolveNavigation, routeModule } from "@/lib/verticals/navigation";

/**
 * LOT PV-2 — le moteur de verticales gouverne l'accès aux pages PV.
 *
 * Ces tests couvrent les points 23 à 27 de la mission. Ils portent sur le
 * MOTEUR EXISTANT : PV-2 n'a ajouté aucun menu parallèle, aucune seconde garde,
 * aucun registre de routes propre au photovoltaïque. Ce qui est testé ici est
 * donc bien la mécanique qui décide RÉELLEMENT, pas une copie de démonstration.
 *
 * Rappel de la propriété centrale : le menu ET la garde serveur lisent la même
 * liste de modules. Un test qui passerait sur l'un et pas sur l'autre
 * signalerait une divergence — c'est exactement ce que ce moteur rend impossible.
 */

// Jeux de capacités RÉELS, tels que `deriveCapabilityTokens` les produit.
const PHOTO = ["photo_studio", "leads", "appointments", "quotes"];
const IMMO = ["properties", "leads", "appointments"];
const SOLAIRE = ["quotes", "worksites", "leads"];

test("23 — un tenant photo n'obtient AUCUN module PV", () => {
  const modules = grantedModules(PHOTO);
  assert.equal(modules.has("solar.studies"), false, "solar.studies ne doit pas être accordé");
  assert.equal(modules.has("worksites"), false);
});

test("23b — un tenant photo ne voit AUCUNE entrée PV dans son menu", () => {
  const modules = grantedModules(PHOTO);
  const nav = resolveNavigation(resolveVertical(PHOTO).vertical, modules);
  assert.equal(
    nav.some((e) => e.moduleId === "solar.studies"),
    false,
  );
  assert.equal(
    nav.some((e) => e.href === "/etudes"),
    false,
  );
});

test("24 — un tenant immobilier n'obtient AUCUN module PV", () => {
  const modules = grantedModules(IMMO);
  assert.equal(modules.has("solar.studies"), false);
  const nav = resolveNavigation(resolveVertical(IMMO).vertical, modules);
  assert.equal(
    nav.some((e) => e.moduleId === "solar.studies"),
    false,
  );
});

test("25 — un tenant solaire obtient le module PV, et la page existe vraiment", () => {
  const modules = grantedModules(SOLAIRE);
  assert.equal(modules.has("solar.studies"), true);

  const def = moduleDef("solar.studies");
  assert.ok(def, "le module solar.studies doit exister au registre");
  assert.equal(def?.route, "/etudes", "PV-2 allume la route : plus de « bientôt »");

  const nav = resolveNavigation("solar", modules);
  const entry = nav.find((e) => e.moduleId === "solar.studies");
  assert.ok(entry, "l'entrée doit apparaître au menu d'un tenant solaire");
  assert.equal(entry?.comingSoon, false, "la page n'est plus « bientôt disponible »");
});

test("26 — une URL PV est refusée sans le module, acceptée avec", () => {
  assert.equal(isRouteAllowed("/etudes", grantedModules(PHOTO)), false);
  assert.equal(isRouteAllowed("/etudes", grantedModules(IMMO)), false);
  assert.equal(isRouteAllowed("/etudes", grantedModules(SOLAIRE)), true);
});

test("26b — sous-routes, query string, slash final et ancre ne contournent PAS la garde", () => {
  const photo = grantedModules(PHOTO);
  for (const url of [
    "/etudes/",
    "/etudes?q=x",
    "/etudes#section",
    "/etudes/123e4567-e89b-12d3-a456-426614174000",
    "/etudes/sites/123e4567-e89b-12d3-a456-426614174000",
    "/etudes/sites/abc?onglet=energie#etude",
  ]) {
    assert.equal(isRouteAllowed(url, photo), false, `${url} doit être refusée à un tenant photo`);
  }
});

test("26c — les mêmes URL restent accessibles au tenant solaire (la garde n'est pas un blocage global)", () => {
  const solaire = grantedModules(SOLAIRE);
  for (const url of ["/etudes/", "/etudes?q=x", "/etudes/abc", "/etudes/sites/abc#x"]) {
    assert.equal(isRouteAllowed(url, solaire), true, `${url} doit être accessible au solaire`);
  }
});

test("26d — toute route PV est REVENDIQUÉE par le module solaire (aucune route non gardée)", () => {
  for (const url of ["/etudes", "/etudes/abc", "/etudes/sites/abc"]) {
    assert.equal(routeModule(url), "solar.studies", `${url} doit appartenir à solar.studies`);
  }
});

test("27 — aucun token générique ne fait fuiter la page PV vers une autre verticale", () => {
  // `quotes` seul : une photographe qui émet des devis le détient.
  assert.equal(grantedModules(["quotes"]).has("solar.studies"), false);
  assert.equal(isRouteAllowed("/etudes", grantedModules(["quotes"])), false);

  // Autres tokens transverses, un par un — aucun ne doit suffire.
  for (const token of ["leads", "crm", "pipeline", "sales", "appointments", "documents", "field_operations"]) {
    assert.equal(
      grantedModules([token]).has("solar.studies"),
      false,
      `le token « ${token} » ne doit pas accorder la verticale PV`,
    );
  }

  // La conjonction EXIGÉE est bien quotes + worksites.
  assert.equal(grantedModules(["worksites"]).has("solar.studies"), false);
  assert.equal(grantedModules(["quotes", "worksites"]).has("solar.studies"), true);
});

test("27b — les actions pv.* appartiennent au module solaire, et à lui seul", () => {
  const solaire = grantedModules(SOLAIRE);
  for (const key of ["pv.bill.extract", "pv.study.prepare", "pv.economics.compute"]) {
    assert.equal(isActionAllowed(key, solaire), true, `${key} doit être rattachée au solaire`);
    assert.equal(
      isActionAllowed(key, grantedModules(PHOTO)),
      false,
      `${key} ne doit PAS être exécutable par un tenant photo`,
    );
    assert.equal(isActionAllowed(key, grantedModules(IMMO)), false);
  }
});

test("27c — le rattachement des actions n'ACTIVE rien : c'est le catalogue qui décide", () => {
  // Garde-fou de lecture : `isActionAllowed` répond « ce module possèderait
  // cette action », pas « cette action est exécutable ». L'exécutabilité tient à
  // `agent_action_catalog.enabled`, vérifiée côté base (db/tests/pv2_facades.test.sql,
  // T18) — ce test documente la frontière pour qu'on ne les confonde pas.
  const solaire = grantedModules(SOLAIRE);
  assert.equal(isActionAllowed("pv.inexistante.action", solaire), true);
  assert.equal(isActionAllowed("pvfake.action", solaire), false, "le préfixe est « pv. », point");
});

// --- Vocabulaire d'affichage : IA ≠ humain ----------------------------------

test("PV-UI — une donnée calculée n'a JAMAIS l'apparence d'une donnée certifiée", () => {
  assert.equal(isHumanCertified("CALCULATED"), false);
  assert.equal(isHumanCertified("NEEDS_REVIEW"), false);
  assert.equal(isHumanCertified("EXTRACTED"), false);
  assert.equal(isHumanCertified("DRAFT"), false);
  assert.equal(isHumanCertified("VERIFIED"), true);
  assert.equal(isHumanCertified("VALIDATED"), true);

  assert.notEqual(pvBadge("CALCULATED").tone, pvBadge("VALIDATED").tone);
  assert.notEqual(pvBadge("NEEDS_REVIEW").tone, pvBadge("VERIFIED").tone);
  assert.notEqual(pvToneClass(pvBadge("CALCULATED").tone), pvToneClass(pvBadge("VALIDATED").tone));
});

test("PV-UI — une étude non validée est marquée « à valider », en toutes lettres", () => {
  assert.match(pvBadge("CALCULATED").label, /valider/i);
  assert.match(pvBadge("NEEDS_REVIEW").label, /valider/i);
  assert.equal(pvBadge("CALCULATED").awaitingHuman, true);
  assert.equal(pvBadge("VALIDATED").awaitingHuman, false);
  assert.match(pvBadge("VALIDATED").label, /humain/i);
});

test("PV-UI — statut inconnu : FAIL-CLOSED sur l'affichage, jamais « certifié »", () => {
  for (const s of [null, undefined, "", "N_IMPORTE_QUOI", "OK"]) {
    assert.equal(isHumanCertified(s), false);
    assert.equal(pvBadge(s).tone, "pending");
    assert.equal(pvBadge(s).awaitingHuman, true);
  }
});

test("PV-UI — nom de prospect : aucune valeur inventée", () => {
  assert.equal(pvProspectName({ lastName: "Dupont" }), "Dupont");
  assert.equal(pvProspectName({ firstName: "Léa", lastName: "Roux" }), "Léa Roux");
  assert.equal(pvProspectName({ companyName: "SolarCorp" }), "SolarCorp");
  assert.equal(
    pvProspectName({ companyName: "SolarCorp", lastName: "Roux" }),
    "SolarCorp — Roux",
  );
  assert.equal(pvProspectName({}), "Prospect sans nom");
});

test("PV-UI — l'azimut NUMÉRIQUE est retraduit en mot, jamais l'inverse", () => {
  assert.match(pvAzimuthLabel(180) ?? "", /^Sud \(180°\)$/);
  assert.match(pvAzimuthLabel(0) ?? "", /^Nord/);
  assert.match(pvAzimuthLabel(90) ?? "", /^Est/);
  assert.match(pvAzimuthLabel(270) ?? "", /^Ouest/);
  assert.match(pvAzimuthLabel(225) ?? "", /^Sud-Ouest/);
  assert.equal(pvAzimuthLabel(null), null);
  assert.equal(pvAzimuthLabel(undefined), null);
  assert.equal(pvAzimuthLabel(Number.NaN), null);
});
