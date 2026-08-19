# Hermès — audit multi-tenant & moteur de dashboard dynamique

État : **audit constaté en base + moteur préparé**. Aucune migration appliquée,
aucun profil supprimé, aucun tenant créé, rien d'activé. `GO_LIVE = NO`.

---

## 1. Ce que le système est aujourd'hui

Tout ce qui suit est **constaté**, pas déduit : lu dans la base de production et
dans le dépôt.

| Brique | Réalité |
| :-- | :-- |
| **Tenant** | `hermes_os.tenants` — **1 ligne** (`heliosolar`). Aucune colonne `vertical`. |
| **Appartenance** | `user_tenant_permissions (user_id, tenant_id, permission)` — **3 lignes**, 1 utilisateur. |
| **Résolution** | `resolve_active_tenant()` — n'accepte jamais un `tenant_id` du client. |
| **Permissions** | Des CHAÎNES : `tenant.member`, `tenant.admin`, `youtube.publication.approve`. |
| **Droits d'exécution** | `agent_action_catalog.required_permission` ⋈ `user_tenant_permissions`. **16 actions**, 5 actives. |
| **Rôles** | ❌ Aucune table, aucun enum. Le mot « founder » n'apparaît **nulle part** dans le code. |
| **Verticale** | ❌ N'existe pas. Le mot n'apparaît que dans des commentaires du module photo. |
| **Modules** | `tenant_module_activation` existe — **0 ligne, référencée par 0 ligne de code**. `photo_studio_activation` (0 ligne) la double pour la photo. |
| **Menu** | ❌ **Écrit à la main** dans `components/dashboard/Sidebar.tsx` : un tableau `NAV` de 13 entrées, filtré par **un seul booléen** (`photoOnly`). |
| **Dashboard** | ✅ Dynamique — `WIDGET_REGISTRY` filtré par capacité (`availableWidgetIds`). |
| **Profils** | ✅ Dynamiques — `PROFILE_REGISTRY` (13), offerts par tokens de capacité. |

### Le vrai défaut : deux vérités au lieu d'une

Le **dashboard** se calcule à partir des capacités. Le **menu**, lui, est écrit à
la main. Rien ne les oblige à s'accorder — et la garde de route est ailleurs
encore. C'est de là que vient la faille du §3.

---

## 2. Pourquoi plusieurs profils apparaissent — la réponse exacte

Ce n'est ni un bug ni un résidu de démonstration. C'est **calculable**, et le
calcul a été vérifié contre la base :

```
5 actions actives   btp.qualification.create · btp.planning.phase.add
                    btp.suivi.progress.report · diag.echo · hermes.intent.resolve
        ↓  CAPABILITY_TOKEN_RULES
8 tokens            leads · sales · quotes · worksites · projects
                    planning · operations · field_operations
        ↓  availableProfiles()
6 profils           direction · commercial · operations · chantier · finance · custom
```

Or `dashboard_user_preferences.profiles` contient **exactement ces 6** profils
enregistrés. Le moteur et la base disent la même chose : rien à nettoyer.

> ⚠️ Un seul est discutable : **`finance`**. Il n'apparaît pas parce que tu fais
> de la comptabilité, mais parce que `btp.qualification` dérive le token `quotes`,
> que le profil Finance accepte. C'est une dérivation indirecte, pas une erreur —
> mais c'est le genre de raccourci qui peuplera les dashboards des futurs tenants
> avec des vues qu'ils n'ont pas demandées.

**Aucun profil de test, aucune fixture, aucun environnement de démonstration
n'existe.** La base ne contient que des données réelles.

---

## 3. Fail-closed : ce qui tient et ce qui ne tient pas

| Route | Auth | Garde de capacité | Verdict |
| :-- | :-- | :-- | :-- |
| `/seances`, `/seances/*`, `/clients` | ✅ | ✅ `notFound()` si `!photoEnabled` | **Fermé** |
| `/`, `/chat`, `/approbations`, `/facturation`, `/securite`, `/integrations` | ✅ | n/a (noyau) | Fermé |
| `/activite`, `/agents`, `/entreprise` | ✅ via `resolvePageContext` | n/a (noyau) | Fermé |
| **`/chantiers/carte`** | ✅ | ❌ **aucune** | ⚠️ **OUVERT** |

`/chantiers/carte` rend la page BTP pour n'importe quel tenant authentifié, y
compris un studio photo. **Aucune fuite de données** — `getChantiersMap()` passe
par `resolve_active_tenant`, donc une photographe verrait une carte *vide* — mais
elle verrait une page qui n'est pas la sienne. C'est exactement le scénario
« route cachée, URL directe » : le menu la cache déjà (`photoOnly`), le serveur
non.

Le motif correct **existe déjà** dans le dépôt (les pages photo). Il n'est
simplement pas généralisé. Le moteur du §5 le généralise.

---

## 4. Les quatre niveaux d'accès — deux existent, deux non

| Niveau | Permission | Provisionné ? |
| :-- | :-- | :-- |
| `TENANT_MEMBER` | `tenant.member` | ✅ oui |
| `TENANT_ADMIN` | `tenant.admin` | ✅ oui |
| `HERMES_OPERATOR` | `hermes.operator` | ❌ **non** |
| `FOUNDER` | `hermes.founder` | ❌ **non** |

Les accorder plus tard = **insérer deux lignes** dans la table existante. Pas de
système parallèle, pas de migration structurelle.

Et une règle non négociable, encodée et testée : **aucun niveau ne franchit la
frontière du tenant** — founder compris. La frontière est tenue en base par
`resolve_active_tenant` + RLS deny-all, pas par l'application.

> ⚠️ **Piège multi-tenant à connaître avant d'ajouter un 2ᵉ tenant** :
> `resolve_active_tenant(null)` renvoie `AMBIGUOUS_TENANT_REQUIRE_SELECTION`
> quand un utilisateur est membre de plusieurs tenants — et **aucun sélecteur de
> tenant n'existe dans l'interface**. Un compte founder rattaché à `heliosolar`
> *et* `studio-vanessa` casserait donc ses propres lectures. Ce n'est pas bloquant
> pour Vanessa (comptes séparés), mais ça le devient dès qu'un opérateur Hermès
> doit voir deux tenants.

---

## 5. Le moteur préparé — une application, plusieurs métiers

Quatre fichiers purs, sans I/O, sans React. **Rien n'est câblé** : le moteur est
livré et testé, pas branché.

```
capacités accordées  (déjà lues par resolvePageContext)
        ↓  deriveCapabilityTokens()          ← RÉUTILISÉ, pas réécrit
      tokens
        ↓  grantedModules()                  ← MODULE_REGISTRY  · sécurité
      modules ────────────────┬──────────────┬───────────────┐
        ↓                     ↓              ↓               ↓
  resolveNavigation()   isRouteAllowed()  moduleWidgets()  isActionAllowed()
     (VERTICAL_MANIFEST)   garde serveur    ∩ capacités      gateway/SW15
      = menu               = URL directe    = dashboard      = exécution
```

Le point central : **les quatre sorties viennent de la MÊME liste de modules.**
Menu et garde ne peuvent plus diverger — il n'y a qu'une source.

### Modules ≠ verticale

* Les **modules** décident de ce qui est **accessible** → sécurité.
* La **verticale** décide de ce qui est **présenté** → ergonomie.

Une verticale ne peut donc jamais élargir un accès : `resolveNavigation` ne fait
qu'ordonner et filtrer une liste déjà accordée. Citer un module qu'un tenant n'a
pas ne le lui donne pas — il disparaît. **C'est testé.**

### Fail-closed sur trois fronts

1. Module non accordé ⇒ route refusée.
2. **Route qu'aucun module ne revendique ⇒ refusée aussi.** Une page ajoutée
   demain sans rattachement est fermée par défaut : l'oubli ferme, il n'ouvre pas.
3. Action dont le préfixe n'appartient à aucun module ⇒ non exécutable.

### La verticale sans migration

`resolveVertical()` se déduit des capacités. La colonne `tenants.vertical`
n'existe pas et **n'est pas nécessaire pour démarrer** : le paramètre `declared`
est optionnel et l'emporte s'il arrive un jour. Le signal le plus spécifique
gagne — `worksites + quotes` ⇒ solaire, `worksites` seul ⇒ BTP.

---

## 6. Intégrations : autorisées, pas seulement existantes

Défaut trouvé dans la PR #59 : `get_tenant_integrations()` filtre sur
`where p.enabled` — **global uniquement**. Tout tenant voit tout fournisseur
activé. Instagram serait proposé à un installateur solaire.

Le moteur corrige côté composition : l'offre est l'**intersection** du catalogue
global activé et des fournisseurs que la verticale justifie
(`verticalIntegrationProviders`). Catalogue vide ⇒ aucune proposition.

Reste à porter la même règle **en base** avant activation — sinon la règle ne
tient que dans l'interface. Voir §8.

---

## 7. Coûts par tenant — le mécanisme existe déjà

`sw19_cost_events` est un journal **générique et déjà multi-tenant** :

```
tenant_id (NOT NULL) · provider · model_or_service · quantity · unit
unit_cost · total_cost · currency · measurement_status · provider_event_id
```

`provider` étant une chaîne libre, **LLM, Retell, téléphonie, SMS, e-mail,
stockage** entrent tous dans la même table sans schéma nouveau. `tenant_id` est
`NOT NULL` : un coût **ne peut pas** être enregistré sans tenant. S'y ajoutent
`sw19_cost_allocations` (ventilation), `sw23_tenant_budget_config` (budgets,
`hard_stop`) et `sw23_budget_ledger` (réservé/réel).

Aucun mélange possible entre Vanessa, HelioSolar et Kevin.

> ⚠️ **Un trou à combler** : `photo_calls` (lot 7, non appliqué) porte ses coûts
> dans ses propres colonnes et **n'alimente pas `sw19_cost_events`**. Les coûts
> téléphoniques seraient donc invisibles pour SW23 — donc hors budget et hors
> kill-switch. À raccorder avant le premier appel facturé.

---

## 8. Retell multi-tenant — un compte Hermès, N tenants

La séparation en deux tables suffit, et elle est structurelle :

| Par tenant (`photo_phone_config`) | Côté Hermès (`phone_provisioning`) |
| :-- | :-- |
| `incoming_number`, `language`, `voice_profile` | `external_agent_ref` |
| `callback_rules`, `transfer_rules` | `number_e164`, `webhook_configured` |
| horaires, prestations, sujets autorisés | `vault_secret_id` |
| `calendar_connected` | — |
| **Façade `authenticated` : oui** | **Façade `authenticated` : aucune** |

Budget et kill-switch ne sont pas à écrire : `sw23_tenant_budget_config` les porte
déjà par tenant (`daily`, `monthly`, `per_request`, `hard_stop`).

La clé Retell reste dans Vault, côté infrastructure. Vanessa n'a **aucune façade**
qui la lise — c'est structurel, pas une consigne.

---

## 9. Reste bloqué

| Bloqué | Par quoi |
| :-- | :-- |
| Câblage du moteur (sidebar, layout, gardes) | Ton autorisation |
| Filtre d'intégration **en base** | Migration à préparer |
| `photo_calls` → `sw19_cost_events` | Migration à préparer |
| Garde de `/chantiers/carte` | Correctif à autoriser |
| Sélecteur de tenant multi-appartenance | Nécessaire avant un compte opérateur |
| Bouclage OAuth | Décision A/B, puis `client_id` Google |
| Appels réels | Credential Retell (Hermès, jamais le tenant) |
