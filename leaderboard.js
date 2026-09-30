const playerKey = name => name.trim().toLocaleLowerCase('en-US');

function sortLeaderboard(rows) {
  return rows.sort((a, b) => b.wins - a.wins || b.points - a.points || b.best - a.best || a.games - b.games || a.name.localeCompare(b.name));
}

export function cleanLeaderboard(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const row of value) {
    if (!row || typeof row.name !== 'string') continue;
    const name = row.name.trim().slice(0, 18);
    const games = Number.isInteger(row.games) && row.games >= 0 ? row.games : 0;
    const wins = Number.isInteger(row.wins) && row.wins >= 0 ? Math.min(row.wins, games) : 0;
    const points = Number.isInteger(row.points) && row.points >= 0 ? row.points : 0;
    const best = Number.isInteger(row.best) && row.best >= 0 ? row.best : 0;
    if (!name || unique.has(playerKey(name))) continue;
    unique.set(playerKey(name), { name, games, wins, points, best });
  }
  return sortLeaderboard([...unique.values()]);
}

export function recordGame(value, players, winnerIndex) {
  const rows = cleanLeaderboard(value);
  if (!Array.isArray(players) || players.length !== 3 || ![0, 1, 2].includes(winnerIndex)) return rows;
  const byKey = new Map(rows.map(row => [playerKey(row.name), row]));
  players.forEach((player, index) => {
    if (!player || typeof player.name !== 'string' || !Number.isInteger(player.total) || player.total < 0) return;
    const name = player.name.trim().slice(0, 18) || `Player ${index + 1}`;
    const key = playerKey(name);
    const row = byKey.get(key) || { name, games: 0, wins: 0, points: 0, best: 0 };
    row.name = name;
    row.games += 1;
    row.wins += index === winnerIndex ? 1 : 0;
    row.points += player.total;
    row.best = Math.max(row.best, player.total);
    byKey.set(key, row);
  });
  return sortLeaderboard([...byKey.values()]);
}
