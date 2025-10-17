import { extractTeamIds, extractTeamsBasic } from "./parsers";

export function isFinished(match: any): boolean {
  return (
    Boolean(match.finished_at) ||
    match.status === "finished" ||
    match.status === "closed"
  );
}

export function splitTeamMatches(matches: any[], myTeamId: string) {
  const mine = matches.filter((m) =>
    extractTeamIds(m.teams).includes(myTeamId),
  );
  const upcoming = mine.filter((m) => !isFinished(m));
  const finished = mine.filter((m) => isFinished(m));
  return { upcoming, finished };
}

export function myTeamResult(
  match: any,
  myTeamId: string,
): "win" | "loss" | "draw" | "unknown" {
  const winner = match.results?.winner as string | undefined;
  const ids = extractTeamIds(match.teams);
  // Map faction1/faction2 to team ids if necessary
  let winnerId = winner;
  if (winner === "faction1" || winner === "faction2") {
    const ts = extractTeamsBasic(match.teams);
    const t1 = ts?.[0]?.team_id as string | undefined;
    const t2 = ts?.[1]?.team_id as string | undefined;
    winnerId = winner === "faction1" ? (t1 ?? undefined) : (t2 ?? undefined);
  }
  if (winnerId && ids.includes(winnerId)) {
    return winnerId === myTeamId ? "win" : "loss";
  }
  // fallback: if results has score fields
  const t = extractTeamsBasic(match.teams);
  const s1 =
    (match.results?.score?.[t?.[0]?.team_id as string] as number) ?? undefined;
  const s2 =
    (match.results?.score?.[t?.[1]?.team_id as string] as number) ?? undefined;
  if (typeof s1 === "number" && typeof s2 === "number") {
    const myIdx =
      t?.[0]?.team_id === myTeamId ? 0 : t?.[1]?.team_id === myTeamId ? 1 : -1;
    if (myIdx >= 0) {
      const myScore = myIdx === 0 ? s1 : s2;
      const oppScore = myIdx === 0 ? s2 : s1;
      if (myScore > oppScore) return "win";
      if (myScore < oppScore) return "loss";
      return "draw";
    }
  }
  return "unknown";
}
