import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { User, Game, WSMessage, AnswerData, CreateGameData, JoinGameData, Player, RegData, StartGameData } from './types';
import { generateRoomCode } from './utilits/generateCode';
import { generateId } from './utilits/generateId';
import { calculatePoints } from './utilits/calculatePoints';
import { getGameRanking } from './utilits/getGameRanking';

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

  console.log(message.data);
}

function handleRegister(ws: WebSocket, data: RegData): void {
  const { name, password } = data;

  if (!name || !password) {
    sendToClient(ws, {
      type: 'reg',
      data: {
        error: true,
        errorText: 'Please, enter name and password to proceed to the game',
      },
      id: 0,
    });
    return;
  }

  let user = Array.from(users.values()).find((u) => u.name === name);

  if (!user) {
    const newUserId = generateId();
    user = {
      name,
      password,
      index: newUserId,
      ws,
    };
    users.set(newUserId, user);
  } else if (user.password !== password) {
    sendToClient(ws, {
      type: 'reg',
      data: {
        name,
        index: '',
        error: true,
        errorText: 'Invalid password',
      },
      id: 0,
    });
    return;
  }

  user.ws = ws;
  playerToUser.set(ws, user);

  sendToClient(ws, {
    type: 'reg',
    data: {
      name: user.name,
      index: user.index,
      error: false,
      errorText: '',
    },
    id: 0,
  });
}

function handleCreateGame(ws: WebSocket, data: CreateGameData): void {
  const user = playerToUser.get(ws);
  if (!user) return;

  const { questions } = data;

  const gameId = generateId();
  const code = generateRoomCode();

  const game: Game = {
    id: gameId,
    code,
    hostId: user.index,
    questions,

    players: [],

    currentQuestion: -1,
    status: 'waiting',
    playerAnswers: new Map(),
  };

  games.set(gameId, game);

  sendToClient(ws, {
    type: 'game_created',
    data: { gameId, code },
    id: 0,
  });
}

function handleJoinGame(ws: WebSocket, data: JoinGameData): void {
  const user = playerToUser.get(ws);
  if (!user) {
    sendToClient(ws, {
      type: 'game_joined',
      data: {
        error: true,
        errorText: 'User not registered',
      },
      id: 0,
    });
    return;
  }

  const { code } = data;
  const game = Array.from(games.values()).find((g) => g.code === code);

  if (!game) {
    sendToClient(ws, {
      type: 'game_joined',
      data: {
        error: true,
        errorText: 'Game not found',
      },
      id: 0,
    });
    return;
  }

  if (game.status !== 'waiting') {
    sendToClient(ws, {
      type: 'game_joined',
      data: {
        error: true,
        errorText: 'Game already in progress or finished',
      },
      id: 0,
    });
    return;
  }

  const alreadyJoined = game.players.some((p) => p.index === user.index);
  if (alreadyJoined) {
    sendToClient(ws, {
      type: 'game_joined',
      data: {
        gameId: game.id,
      },
      id: 0,
    });
    return;
  }

  const newPlayer: Player = {
    name: user.name,
    index: user.index,
    score: 0,
    ws,
    hasAnswered: false,
  };

  game.players.push(newPlayer);
  playerToGame.set(user.index, game.id);

  sendToClient(ws, {
    type: 'game_joined',
    data: {
      gameId: game.id,
    },
    id: 0,
  });

  broadcastToGame(game.id, {
    type: 'player_joined',
    data: {
      playerName: user.name,
      playerCount: game.players.length,
    },
    id: 0,
  });

  broadcastToGame(game.id, {
    type: 'update_players',
    data: game.players.map((p) => ({
      name: p.name,
      index: p.index,
      score: p.score,
    })),
    id: 0,
  });
}

function handleStartGame(ws: WebSocket, data: StartGameData): void {
  const user = playerToUser.get(ws);
  if (!user) return;

  const { gameId } = data;
  const game = games.get(gameId);

  if (!game || game.hostId !== user.index) {
    sendToClient(ws, {
      type: 'error',
      data: { message: 'Only host can start game' },
      id: 0,
    });
    return;
  }

  game.status = 'in_progress';
  game.currentQuestion = 0;

  sendNextQuestion(game);
}

function sendNextQuestion(game: Game): void {
  if (game.currentQuestion >= game.questions.length) {
    endGame(game);
    return;
  }

  const question = game.questions[game.currentQuestion];
  game.questionStartTime = Date.now();

  game.playerAnswers.clear();
  game.players.forEach((p) => {
    p.hasAnswered = false;
    p.answeredCorrectly = undefined;
    p.answerTime = undefined;
  });

  broadcastToGame(game.id, {
    type: 'question',
    data: {
      questionNumber: game.currentQuestion + 1,
      totalQuestions: game.questions.length,
      text: question.text,
      options: question.options,
      timeLimitSec: question.timeLimitSec,
    },
    id: 0,
  });

  if (game.questionTimer) {
    clearTimeout(game.questionTimer);
  }

  game.questionTimer = setTimeout(() => {
    handleQuestionTimeout(game);
  }, question.timeLimitSec * 500);
}

function handleAnswer(ws: WebSocket, data: AnswerData): void {
  const user = playerToUser.get(ws);
  if (!user) return;

  const { gameId, questionIndex, answerIndex } = data;
  const game = games.get(gameId);

  if (!game || game.currentQuestion !== questionIndex) return;

  if (user.index === game.hostId) return;

  const player = game.players.find((p) => p.index === user.index);
  if (!player || player.hasAnswered) return;

  const timestamp = Date.now();
  const timeUsedSec =
    (timestamp - (game.questionStartTime || timestamp)) / 1000;

  game.playerAnswers.set(user.index, {
    answerIndex,
    timestamp,
  });

  player.hasAnswered = true;
  player.answerTime = timeUsedSec;

  sendToClient(ws, {
    type: 'answer_accepted',
    data: { questionIndex },
    id: 0,
  });

  const allAnswered = game.playerAnswers.size === game.players.length;

  if (allAnswered) {
    handleQuestionTimeout(game);
  }
}

function handleQuestionTimeout(game: Game): void {
  if (game.questionTimer) {
    clearTimeout(game.questionTimer);
    game.questionTimer = undefined;
  }

  const question = game.questions[game.currentQuestion];
  const questionStartTime = game.questionStartTime || Date.now();

  const playerResults = game.players.map((player) => {
    const answer = game.playerAnswers.get(player.index);
    let answered = false;
    let correct = false;
    let pointsEarned = 0;

    if (answer) {
      answered = true;
      correct = answer.answerIndex === question.correctIndex;
      const timeUsedSec = (answer.timestamp - questionStartTime) / 1000;
      pointsEarned = calculatePoints(correct, question.timeLimitSec, timeUsedSec);
      player.score += pointsEarned;
    }

    player.answeredCorrectly = correct;

    return {
      name: player.name,
      answered,
      correct,
      pointsEarned,
      totalScore: player.score,
    };
  });

  broadcastToGame(game.id, {
    type: 'question_result',
    data: {
      questionIndex: game.currentQuestion,
      correctIndex: question.correctIndex,
      playerResults,
    },
    id: 0,
  });

  setTimeout(() => {
    game.currentQuestion++;
    sendNextQuestion(game);
  }, 3000);
}

function endGame(game: Game): void {
  game.status = 'finished';

  console.log('🎮 Game ended!');

  const scoreboard = getGameRanking(game);

  broadcastToGame(game.id, {
    type: 'game_finished',
    data: {
      scoreboard,
    },
    id: 0,
  });
}

wss.on('connection', (ws: WebSocket) => {
  console.log('🚀 Connection have been established');

  ws.on('message', (messageData: string) => {
    try {
      const message: WSMessage = JSON.parse(messageData);

      switch (message.type) {
        case 'reg':
          handleRegister(ws, message.data);
          break;
        case 'create_game':
          handleCreateGame(ws, message.data);
          break;
        case 'join_game':
          handleJoinGame(ws, message.data);
          break;
        case 'start_game':
          handleStartGame(ws, message.data);
          break;
        case 'answer':
          handleAnswer(ws, message.data);
          break;
        default:
          console.log('❓ Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('⛔ Error processing message:', error);
    }
  });

  ws.on('close', () => {
  const user = playerToUser.get(ws);
  if (!user) return;

  const game = Array.from(games.values()).find(
    (g) => g.hostId === user.index
  );

  if (game) {
    broadcastToGame(game.id, {
      type: 'game_finished',
      data: { reason: 'Host disconnected' },
      id: 0,
    });

    games.delete(game.id);
    return;
  }

  const gameId = playerToGame.get(user.index);
  if (gameId) {
    const game = games.get(gameId);
    if (game) {
      game.players = game.players.filter((p) => p.index !== user.index);

      if (game.players.length === 0) {
        games.delete(gameId);
      } else {
        broadcastToGame(gameId, {
          type: 'update_players',
          data: game.players.map((p) => ({
            name: p.name,
            index: p.index,
            score: p.score,
          })),
          id: 0,
        });
      }
    }

    playerToGame.delete(user.index);
  }

  playerToUser.delete(ws);
});

  ws.on('error', (error) => {
    console.error('⛔ WebSocket error:', error);
  });
});

console.log(`🏃 WebSocket server running at ws://localhost:${PORT}`);
