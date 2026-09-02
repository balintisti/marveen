-- Kartya 68472942 utani kor / marveen kerese, 2026-09-02.
--
-- A KERDES NEM EGY LELET, HANEM EGY NEVEZO. Tobb mai HIGH lelet sulyat ma az tartja lent,
-- hogy EGYETLEN berlonek sincs masodik felhasznaloja: nincs bent senki, aki kihasznalhatna
-- oket. Ez ALLAPOT-allitas, tehat romlando -- es az elso elfogadott meghivassal fordul.
--
-- A KET UTOLSO SOR A KONTROLL, ES NEM DISZITES. Ha a `orgs_total` vagy a `users_total` nulla,
-- akkor ez a lekerdezes NEM a valodi tablat nezi (mas sema, mas nev, ures adatbazis), es akkor
-- a folso ket nulla nem "nincs masodik felhasznalo", hanem "nem mertem". A hivo szkript
-- kimondottan erre a ket sorra kapuz: nulla nevezo = NEM MERTEM, nem "tiszta".
SELECT 'orgs_with_second_user' AS metric, count(*)::bigint AS value
FROM (
  SELECT "organizationId" FROM "User" WHERE "deletedAt" IS NULL
  GROUP BY 1 HAVING count(*) > 1
) q
UNION ALL SELECT 'invitations_ever', count(*)::bigint FROM "UserInvitation"
UNION ALL SELECT 'orgs_total',  count(DISTINCT "organizationId")::bigint FROM "User" WHERE "deletedAt" IS NULL
UNION ALL SELECT 'users_total', count(*)::bigint FROM "User" WHERE "deletedAt" IS NULL
ORDER BY 1;
