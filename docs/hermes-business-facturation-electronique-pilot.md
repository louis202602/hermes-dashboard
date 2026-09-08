# Hermès Business — pilote Facturation électronique

Status: DORMANT / PREPARED / NO OUTBOUND ENABLED

## Objective

Create a low-touch B2B service that helps French TPE/PME prepare and configure electronic invoicing using an existing approved platform. Hermès is an implementation/support layer, not an approved invoicing platform and not a tax adviser.

## Commercial offer

### Pack Essentiel — 490 EUR HT
- company situation check
- current invoicing software inventory
- approved-platform shortlist
- configuration assistance
- reception test
- preparation for mandatory emission in 2027 when applicable
- short operating procedure

### Pack Pro — 990 EUR HT
Everything in Essentiel plus:
- multi-user/process configuration
- reception/emission test plan
- migration/connection assistance
- 30 days support

### Complex case
Quote required, target ceiling 1,990 EUR HT for the pilot.

### Optional support
49 EUR HT/month after implementation. Not pushed in the initial sale.

## ICP v1

Target French companies with:
- 2–50 employees
- active legal status
- VAT-liable activity when verifiable
- regular B2B invoicing likely
- no obvious internal IT/finance transformation team
- reachable professional contact on official/corroborated domain

Priority sectors:
1. building / structured trades
2. maintenance and B2B repair
3. professional cleaning
4. transport / small logistics
5. garages and B2B automotive services
6. security
7. agencies and professional practices
8. small IT providers
9. engineering offices
10. B2B-oriented retail/services

Reject or defer:
- liquidated/closed entities
- large enterprise / ETI for pilot
- public bodies
- non-corroborated company/domain/contact
- companies clearly already fully configured, unless they request audit/support

## Reliability rule

A prospect cannot be marked QUALIFIED if any critical identity layer is weak:
- company identity/status
- activity
- official/corroborated domain
- professional contact

When evidence is insufficient: REVIEW, never QUALIFIED.

## Lead scoring v1 (100)

- 2–50 employees: +20
- clear B2B activity: +15
- recurring invoicing probable: +15
- priority sector: +15
- active official website/company corroborated: +10
- verified professional email: +10
- decision maker identifiable: +5
- invoicing software absent/legacy/unclear: +5
- admin/digital-help signal: +5

Tiers:
- P1: 80–100
- P2: 65–79
- P3: 50–64, enrich before outreach
- REJECT: <50

Hard fail overrides score when critical corroboration is missing.

## Prospect record minimum schema

```json
{
  "company_name": "",
  "siren": "",
  "siret": "",
  "legal_status": "ACTIVE|UNKNOWN|CLOSED",
  "sector": "",
  "employee_band": "",
  "city": "",
  "website": "",
  "domain_status": "VERIFIED|CORROBORATED|UNVERIFIED",
  "contact_name": "",
  "contact_role": "",
  "contact_email": "",
  "email_status": "VERIFIED|CORROBORATED|UNVERIFIED",
  "b2b_signal": true,
  "invoicing_signal": "",
  "software_signal": "",
  "score": 0,
  "tier": "P1|P2|P3|REJECT|REVIEW",
  "evidence": [],
  "do_not_contact": false
}
```

## Outbound message v1

Subject: `Facturation électronique — {{company_name}} est-elle déjà configurée ?`

Body:

Bonjour {{first_name}},

Depuis le 1er septembre 2026, les entreprises concernées doivent être en mesure de recevoir leurs factures électroniques via une plateforme agréée.

Pour {{company_name}}, nous pouvons vérifier votre logiciel actuel, la plateforme adaptée et tester que la réception fonctionne correctement, puis préparer l'émission obligatoire de 2027 si elle s'applique à votre situation.

L'objectif est simplement que tout soit configuré et fonctionnel, sans que vous ayez à étudier toute la réforme.

Si vous êtes déjà entièrement configuré, dites-le-moi et je ne vous relancerai pas.

Louis
Hermès Facture Électronique

## Response classifier

Allowed states:
- READY — already configured, stop campaign
- INTERESTED — wants help, open diagnostic
- NOT_READY — not configured, highest commercial priority
- HAS_SOFTWARE — existing software, compatibility check
- HAS_PLATFORM — approved platform already chosen, configuration/test audit
- ACCOUNTANT_HANDLES_IT — accountant claims to handle it; verify whether setup is actually complete
- QUESTION — answer with sourced/verified information, no invented legal/tax advice
- REFUSAL — immediate DNC
- UNSURE — human review

## Diagnostic intake

Collect only what is needed:
1. SIREN/SIRET
2. employee band
3. VAT situation when relevant
4. customer mix: B2B/B2C/international
5. current invoicing software
6. approved platform already selected or not
7. approximate invoice volume/month
8. number of users/entities
9. reception operational or not
10. emission preparation needed before 2027 or later

## Fulfilment state machine

`NEW -> QUALIFIED -> CONTACTED -> REPLIED -> DIAGNOSTIC -> OFFERED -> WON -> ONBOARDING -> CONFIGURING -> TESTING -> DELIVERED -> SUPPORT`

Terminal states:
`REJECTED`, `DNC`, `LOST`, `NOT_APPLICABLE`, `ALREADY_READY`.

## Hermès responsibility split

Hermès Business:
- sourcing
- enrichment
- evidence collection
- scoring
- outreach preparation
- response classification
- pipeline metrics

Hermès OS:
- onboarding
- client dossier
- tasks
- delivery checklist
- support
- billing status

Hermès Visibility:
- landing page
- local/organic acquisition
- FAQ/content based only on verified official sources

Premium model / computer-use layer:
- complex website/app navigation
- unknown software analysis
- UI configuration assistance
- difficult error diagnosis
- final complex review

Cheap models handle classification, extraction, templating and routine enrichment.

## Safety / activation gates

The pilot must remain dormant until all gates pass:

G1 — data model and dedupe tested
G2 — critical-evidence fail-closed logic tested
G3 — DNC/opt-out tested
G4 — email domain/deliverability checks pass
G5 — response classifier tested on at least 30 labelled examples
G6 — diagnostic workflow tested end-to-end with synthetic data
G7 — cost routing / SW23 limits in place
G8 — no claim that Hermès is an approved invoicing platform
G9 — no automatic legal/tax advice beyond verified source-backed information
G10 — operator approval immediately before first real outbound campaign

No real email is sent by merely merging this document.

## Pilot economics and validation

First cohort: 100 P1/P2 prospects.

Track separately:
- verified prospects
- delivered emails
- replies
- positive replies
- diagnostics started
- offers sent
- sales
- collected revenue
- AI/tool cost
- human minutes
- refunds/incidents
- gross margin

Initial validation threshold: 3 paid sales / 100 qualified prospects.

At 490 EUR HT only:
- 3 sales = 1,470 EUR HT revenue
- 5 sales = 2,450 EUR HT revenue
- 10 sales = 4,900 EUR HT revenue

These are test thresholds, not forecasts.

## Regulatory source of truth

See `docs/hermes-business-einvoicing-official-sources.md`. Commercial and support answers must be refreshed from official DGFiP/Ministry sources when the answer is date- or situation-sensitive.

## Next engineering steps

1. map this vertical to the existing Hermès Business prospect/enrichment schema instead of creating a parallel database if avoidable
2. implement the scoring function as additive, niche-scoped logic
3. create a niche-scoped prospect selector that cannot alter `pv_toitures`
4. add the response classifier contract
5. add a dormant/manual n8n consumer/driver for the pilot
6. run synthetic tests
7. inspect 20 prospects manually for evidence quality
8. only then request operator approval for the first real 100-prospect outbound cohort
