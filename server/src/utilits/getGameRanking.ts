import { Game } from "../types";

export const getGameRanking = (game: Game) => {
  const sorted = [...game.players].sort((a, b) => b.score - a.score);

  return sorted.map((player, index) => ({
    name: player.name,
    score: player.score,
    rank: index + 1,
  }));
}