-- ============================================================================
-- MEGVALASZOLVA 2026-09-10. NE FUTTASD UJRA NYITOTT KERDESKENT.
--
-- A LEKERDEZES ALATTA LEFUTOTT (marveen, 08:5x, majd fuggetlenul ujra 23:2x --
-- azonos szamok). A VALASZ:
--
--   A JOG SOHA NEM HIANYZOTT.
--     roles_granted_reopen 87  |  roles_granted_complete 87   <- AZONOS
--     owner_roles_with_reopen 29  |  roles_named_owner 29     <- MIND
--     users_effectively_having_reopen 30 / users_total 30     <- MINDENKI, Isti is
--     KONTROLL: permissions_total 95 | role_permissions_total 7139 -- nem nulla nevezo
--   Vagyis a fenti DISZKRIMINATOR (complete kontra reopen) sajat kikotese szerint:
--   NEM a kotes hianyzik, mashol kell keresni. Ez a kereses BEFEJEZODOTT.
--
--   A VALODI OK: A VISSZANYITASNAK KET FELTETELE VAN, es ez a fajl csak az ELSOT meri.
--     1. a JOG ..... CompletedWorkSection.tsx:62  hasPermission('tasks','reopen')
--     2. az ABLAK .. useOrganizationSettings.ts:81-99  useCanReopenTask(completedAt)
--   `taskReopenLimit`, ALAPERTELMEZES 1 ORA, es mind a 29 szervezet '1h'-n all
--   (a Product szinten is: id=1 '1h', a tobbi 6 NULL -> visszaesik a szervezetire).
--
--   EZERT LATTA UGY ISTI, HOGY "NINCS GOMB": a gomb RENDERELODIK, csak `disabled`
--   (CompletedWorkItem.tsx:98-120), az "Elvegzett munkak" kartya pedig ALAPBOL
--   OSSZECSUKVA van, tehat ranezesre semmi nem latszik.
--
--   A teljes lelet:      kartya 9a298a75  (lezarva)
--   A folytatas:         kartya 33c0258c  -- Isti kerese, hogy az ablak legyen ALLITHATO
--
-- MIERT ALL EZ ITT, ES NEM CSAK A KARTYAN: a fajlt UJRAFUTTATTAK nyitott kerdeskent,
-- MIUTAN a valasz mar megvolt -- ugyanaz az ember, aki megmerte. Aki ezt megnyitja, EZT
-- olvassa, nem a kartyat. Az indok oda valo, ahol az olvaso a DONTES pillanataban all.
-- (friday merte meg a hianyt: valasz-kulcsszo a fajlban 0, kontroll `tasks:reopen` 1.)
-- ============================================================================

-- [AZ EREDETI FELVETES, 2026-09-10 08:3x. A KOVETKEZO MONDAT MEGDOLT -- lasd a fejlecet:
--  a frontendnek KET feltetele van, nem egy. Nem torlom, mert a lekerdezes ALAKJAT ez
--  magyarazza, es egy javitott sor mellett a regi indoklas ugy hat, mintha meg allna.]
-- Isti 2026-09-10: "Tulajdonos szerepkorom van, a visszanyitas ott van a szerepkorben,
-- megsem latok gombot." A frontend EGYETLEN feltetele a gombra a `tasks:reopen` jog
-- (CompletedWorkItem.tsx: `onReopen && (...)`, es `onReopen = hasReopenPermission ? ... : undefined`).
-- Tehat a kerdes: a szerepkorhoz TENYLEG hozza van-e KOTVE a jogosultsag, vagy csak a
-- katalogusban latszik.
--
-- A DISZKRIMINATOR A TESTVER-JOG: a `tasks:complete` MUKODIK neki (le tud zarni teendot).
-- Ha a complete N szerepkorhoz kotott es a reopen KEVESEBBHEZ, az a valasz. Ha mindketto
-- ugyanannyi, akkor NEM a kotes hianyzik, es mashol kell keresni.
--
-- A KET UTOLSO SOR A KONTROLL: ha a `permissions_total` vagy a `role_permissions_total`
-- nulla, akkor ez a lekerdezes NEM a valodi tablakat nezi, es a folso nullak nem
-- "nincs bekotve", hanem "nem mertem".
--
-- CSAK OSSZESITETT DARABSZAM. Sor-tartalom, nev, email SEHOL.
SELECT 'perm_rows_tasks_reopen' AS metric, count(*)::bigint AS value
  FROM "Permission" WHERE resource = 'tasks' AND action = 'reopen'
UNION ALL SELECT 'perm_rows_tasks_complete', count(*)::bigint
  FROM "Permission" WHERE resource = 'tasks' AND action = 'complete'
UNION ALL SELECT 'roles_granted_reopen', count(DISTINCT rp."roleId")::bigint
  FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId"
  WHERE p.resource = 'tasks' AND p.action = 'reopen'
UNION ALL SELECT 'roles_granted_complete', count(DISTINCT rp."roleId")::bigint
  FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId"
  WHERE p.resource = 'tasks' AND p.action = 'complete'
UNION ALL SELECT 'roles_named_owner', count(*)::bigint
  FROM "Role" WHERE slug = 'owner'
UNION ALL SELECT 'owner_roles_with_reopen', count(DISTINCT r.id)::bigint
  FROM "Role" r
  JOIN "RolePermission" rp ON rp."roleId" = r.id
  JOIN "Permission" p ON p.id = rp."permissionId"
  WHERE r.slug = 'owner' AND p.resource = 'tasks' AND p.action = 'reopen'
UNION ALL SELECT 'permissions_total', count(*)::bigint FROM "Permission"
UNION ALL SELECT 'role_permissions_total', count(*)::bigint FROM "RolePermission"
ORDER BY 1;
