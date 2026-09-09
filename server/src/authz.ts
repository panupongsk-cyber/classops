import type { DatabasePool } from "./db.js";

export type MembershipRole = "owner" | "teacher" | "student" | "ta";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
}

/** Roles that may manage `student`/`ta` membership rows for a section (not the `owner` role itself). */
const membershipManagerRoles: readonly MembershipRole[] = ["owner", "teacher"];

export async function getSectionRoles(
  pool: DatabasePool,
  userId: string,
  sectionId: string,
): Promise<MembershipRole[]> {
  const result = await pool.query<{ roles: MembershipRole[] }>(
    `SELECT roles FROM memberships WHERE user_id = $1 AND section_id = $2`,
    [userId, sectionId],
  );
  return result.rows[0]?.roles ?? [];
}

export function hasAnyRole(roles: MembershipRole[], allowed: readonly MembershipRole[]) {
  return roles.some((role) => allowed.includes(role));
}

/** `owner` or `teacher` may add/remove `student`/`ta` roles; only `owner` may grant/revoke `owner`. */
export function canManageMembership(
  actorRoles: MembershipRole[],
  targetRoles: readonly MembershipRole[],
) {
  const grantsOrRevokesOwner = targetRoles.includes("owner");
  if (grantsOrRevokesOwner) return hasAnyRole(actorRoles, ["owner"]);
  return hasAnyRole(actorRoles, membershipManagerRoles);
}

export async function requireSectionManager(
  pool: DatabasePool,
  userId: string,
  sectionId: string,
  targetRoles: readonly MembershipRole[],
): Promise<boolean> {
  const roles = await getSectionRoles(pool, userId, sectionId);
  return canManageMembership(roles, targetRoles);
}
