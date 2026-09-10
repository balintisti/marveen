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
