-- PACK PHOTOVOLTAÏQUE — LOT PV-7 / 3b — CORRECTIF du gel des lignes de commande.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- CE QUE LA PREMIÈRE VERSION FAISAIT DE FAUX, constaté en exécutant l'assertion
-- T37 : `pv_po_line_immutable_guard` comparait `to_jsonb(new)` à `to_jsonb(old)`
-- en excluant `quantity_received`, `expected_delivery_on` et `updated_at`.
--
-- Or `line_total_ht_eur` est une colonne `GENERATED ALWAYS AS … STORED`, et
-- PostgreSQL ne la calcule qu'APRÈS les déclencheurs `BEFORE`. Dans `NEW` elle
-- vaut donc NULL, alors que dans `OLD` elle porte le total. Les deux objets JSON
-- étaient par conséquent TOUJOURS différents, et la garde refusait toute mise à
-- jour de ligne sur une commande passée — y compris celle que le report de
-- réception effectue lui-même.
--
-- Conséquence mesurée : `record_pv_purchase_receipt` renvoyait `INVALID_RECEIPT`
-- dès la première livraison. La réception était intégralement impossible.
--
-- LE CORRECTIF : exclure aussi `line_total_ht_eur` de la comparaison. Aucune
-- garantie n'est perdue — ce total ne peut pas être falsifié, il dérive de
-- `quantity` et `unit_price_ht_eur`, qui restent comparés tous les deux.
--
-- Fichier SÉPARÉ, conformément à la gouvernance : `pv7_3` est déjà appliquée en
-- production ; on ne réécrit pas une migration appliquée.

begin;

create or replace function hermes_os.pv_po_line_immutable_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_status text;
begin
  select o.status into v_status from hermes_os.pv_purchase_orders o
   where o.id = coalesce(new.order_id, old.order_id) and o.tenant_id = coalesce(new.tenant_id, old.tenant_id);

  if v_status is null or v_status in ('DRAFT','READY') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'PV_LIGNE_COMMANDE_FIGEE: une ligne de commande passee ne se supprime pas.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    raise exception 'PV_LIGNE_COMMANDE_FIGEE: aucune ligne ne s''ajoute a une commande deja passee.'
      using errcode = 'check_violation';
  end if;

  -- Peuvent encore bouger : la réception, la date attendue, l'horodatage — et
  -- `line_total_ht_eur`, colonne GÉNÉRÉE que PostgreSQL n'a pas encore calculée
  -- à ce stade (elle vaut NULL dans NEW). L'exclure ne perd aucune garantie :
  -- elle dérive de `quantity` et `unit_price_ht_eur`, tous deux comparés.
  if to_jsonb(new) - 'quantity_received' - 'expected_delivery_on' - 'updated_at' - 'line_total_ht_eur'
     is distinct from
     to_jsonb(old) - 'quantity_received' - 'expected_delivery_on' - 'updated_at' - 'line_total_ht_eur'
  then
    raise exception 'PV_LIGNE_COMMANDE_FIGEE: le contenu commercial d''une commande passee est fige (article, quantite, prix, TVA).'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

comment on function hermes_os.pv_po_line_immutable_guard() is
  'PV-7 — gel commercial d''une ligne de commande passee. Exclut line_total_ht_eur : colonne GENEREE, NULL dans NEW en BEFORE UPDATE.';

commit;
