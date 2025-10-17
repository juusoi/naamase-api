export function extractTeamEntries(teams: any): any[] {
  if (Array.isArray(teams)) return teams as any[];
  if (teams && typeof teams === "object") return Object.values(teams as any);
  return [];
}

export function extractTeamIds(teams: any): string[] {
  const entries = extractTeamEntries(teams);
  return entries
    .map((t: any) => t?.team_id ?? t?.faction_id ?? t?.team?.team_id)
    .filter(Boolean);
}

export function extractTeamsBasic(
  teams: any,
): { team_id?: string; name?: string }[] {
  const entries = extractTeamEntries(teams);
  return entries.map((t: any) => ({
    team_id: t?.team_id ?? t?.faction_id ?? t?.team?.team_id,
    name: t?.name ?? t?.team?.name ?? undefined,
  }));
}
