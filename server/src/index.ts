import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { User, Game, WSMessage, AnswerData, CreateGameData, JoinGameData, Player, RegData, StartGameData } from './types';
import { generateRoomCode } from './utilits/generateCode';
import { generateId } from './utilits/generateId';
import { calculatePoints } from './utilits/calculatePoints';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const wss = new WebSocketServer({ port: PORT });

const users = new Map<string, User>();
const games = new Map<string, Game>();
const playerToGame = new Map<string, string>();
const playerToUser = new Map<WebSocket, User>();

function sendToClient(ws: WebSocket, message: WSMessage): void {
  ws.send(JSON.stringify(message));
}

function broadcastToGame(gameId: string, message: WSMessage): void {
  const game = games.get(gameId);
  if (!game) return;

  game.players.forEach((player) => {
    if (player.ws && player.ws.readyState === player.ws.OPEN) {
      sendToClient(player.ws, message);
    }
  });

  const hostUser = Array.from(users.values()).find(
    (u) => u.index === game.hostId
  );

  if (hostUser?.ws && hostUser.ws.readyState === hostUser.ws.OPEN) {
    sendToClient(hostUser.ws, message);
  }
}
