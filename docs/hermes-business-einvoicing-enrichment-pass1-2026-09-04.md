# Facturation électronique — enrichissement pass 1

Date: 2026-09-04

Official/company-registry checks added after the 20-candidate pre-audit.

## Propreté MTP / MTP SERVICES

- Official registry match found: MTP SERVICES, SIREN 847 971 926, active.
- Activity: nettoyage courant des bâtiments.
- Employee band: 20–49 (2023 statistical band).
- Company category: PME.
- VAT number shown by official registry.
- Website: https://www.propretemtp.fr/
- Website displays `proprete@mtp-services.fr`; email domain differs from website domain, so the contact/domain relationship still needs corroboration before `QUALIFIED`.
- Preliminary outcome: `REVIEW`, not P1/P2 yet, because critical contact/domain corroboration is incomplete.
- Registry source: https://annuaire-entreprises.data.gouv.fr/entreprise/847971926

## HYCLEAN

- Official registry match found: HYCLEAN, SIREN 829 833 284, active.
- Activity: nettoyage courant des bâtiments.
- Employee band: 100–199 (2023 statistical band).
- Website and same-domain email were found (`contact@hyclean.fr`).
- Pilot ICP is 2–50 employees.
- Outcome: `REJECT` for this pilot due employee size, despite otherwise strong B2B/contact evidence. This verifies that sector/contact strength does not override the ICP size rule.
- Registry source: https://annuaire-entreprises.data.gouv.fr/entreprise/829833284

## ATRIA Solutions

- Official registry match found: ATRIA SOLUTIONS (AS), SIREN 810 926 709, active.
- Activity: conseil en systèmes et logiciels informatiques.
- Headquarters establishment is active in Colomiers.
- Website: https://atria-solutions.com/ and professional contact `infos@atria-solutions.com` were found on the official site.
- The first registry result did not expose an employee band in the fetched excerpt, so the candidate stays `REVIEW` until employee size is corroborated.
- Registry source: https://annuaire-entreprises.data.gouv.fr/etablissement/81092670900025

## Quality finding

The fail-closed policy is doing useful work:
- one apparently attractive candidate (HYCLEAN) is rejected after authoritative size verification;
- one candidate (MTP SERVICES) has a strong legal/size match but still cannot be qualified because the contact/domain relationship is not yet fully corroborated;
- one candidate (ATRIA) has legal + domain + contact evidence but remains REVIEW because employee size is not yet confirmed.

No outbound action was taken.
