import type { EngineStatus, GameEngine, MoveResult } from "@arcade/game-core";

/** a8 = 0 … h1 = 63. Human is white; the bot is black. */
type Side = "w" | "b";
type Promo = "q" | "r" | "b" | "n";

export type ChessMove = { from: number; to: number; promotion?: Promo };

type Pos = {
  board: string[];
  turn: Side;
  castling: string;
  ep: number | null;
  halfmove: number;
  fullmove: number;
};

export type ChessState = Pos & {
  kind: "chess";
  cols: 8;
  seen: string[];
  moves: ChessMove[];
  check: boolean;
  lastFrom: number | null;
  lastTo: number | null;
};

const KNIGHT = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
] as const;

const BISHOP = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

const ROOK = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

const KING = [...BISHOP, ...ROOK] as const;

const CASTLES = [
  { side: "w" as const, right: "K", kingFrom: 60, kingTo: 62, rookFrom: 63, rookTo: 61, empty: [61, 62], safe: [60, 61, 62] },
  { side: "w" as const, right: "Q", kingFrom: 60, kingTo: 58, rookFrom: 56, rookTo: 59, empty: [57, 58, 59], safe: [60, 58, 59] },
  { side: "b" as const, right: "k", kingFrom: 4, kingTo: 6, rookFrom: 7, rookTo: 5, empty: [5, 6], safe: [4, 5, 6] },
  { side: "b" as const, right: "q", kingFrom: 4, kingTo: 2, rookFrom: 0, rookTo: 3, empty: [1, 2, 3], safe: [4, 2, 3] },
];

const MAT: Record<string, number> = {
  P: 100,
  N: 320,
  B: 330,
  R: 500,
  Q: 900,
  K: 0,
  p: -100,
  n: -320,
  b: -330,
  r: -500,
  q: -900,
  k: 0,
};

const PST: Record<string, number[]> = {
  P: pawnTable(),
  N: centerTable(6),
  B: centerTable(4),
  R: rookTable(),
  Q: centerTable(3),
  K: kingTable(),
};

function pawnTable(): number[] {
  const t = Array<number>(64).fill(0);
  for (let i = 0; i < 64; i++) {
    const r = Math.floor(i / 8);
    const c = i % 8;
    if (r >= 1 && r <= 6) t[i] = (6 - r) * 8;
    if (c >= 2 && c <= 5) t[i]! += 6;
  }
  return t;
}

function centerTable(scale: number): number[] {
  const t: number[] = [];
  for (let i = 0; i < 64; i++) {
    const r = Math.floor(i / 8);
    const c = i % 8;
    const dist = Math.abs(r - 3.5) + Math.abs(c - 3.5);
    t.push(Math.round((4 - dist) * scale));
  }
  return t;
}

function rookTable(): number[] {
  const t = Array<number>(64).fill(0);
  for (let c = 0; c < 8; c++) t[8 + c] = 16;
  return t;
}

function kingTable(): number[] {
  const t: number[] = [];
  for (let i = 0; i < 64; i++) {
    const r = Math.floor(i / 8);
    const c = i % 8;
    const back = r === 7 ? 24 : r === 6 ? 8 : -16;
    const wing = c <= 1 || c >= 6 ? 10 : 0;
    t.push(back + wing);
  }
  return t;
}

function startBoard(): string[] {
  const board = Array<string>(64).fill("");
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let i = 0; i < 8; i++) {
    board[i] = back[i]!;
    board[8 + i] = "p";
    board[48 + i] = "P";
    board[56 + i] = back[i]!.toUpperCase();
  }
  return board;
}

function own(side: Side, piece: string): boolean {
  if (!piece) return false;
  return side === "w" ? piece === piece.toUpperCase() : piece !== piece.toUpperCase();
}

function enemy(side: Side, piece: string): boolean {
  if (!piece) return false;
  return side === "w" ? piece !== piece.toUpperCase() : piece === piece.toUpperCase();
}

function normalizeCastle(castling: string): string {
  return ["K", "Q", "k", "q"].filter((ch) => castling.includes(ch)).join("");
}

function kingSquare(board: string[], side: Side): number {
  return board.indexOf(side === "w" ? "K" : "k");
}

function rayHits(
  board: string[],
  r: number,
  c: number,
  dr: number,
  dc: number,
  a: string,
  b: string,
): boolean {
  let nr = r + dr;
  let nc = c + dc;
  while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
    const piece = board[nr * 8 + nc] ?? "";
    if (piece) return piece === a || piece === b;
    nr += dr;
    nc += dc;
  }
  return false;
}

function attacked(board: string[], sq: number, by: Side): boolean {
  const r = Math.floor(sq / 8);
  const c = sq % 8;
  const pawnRow = by === "w" ? r + 1 : r - 1;
  const pawn = by === "w" ? "P" : "p";
  if (pawnRow >= 0 && pawnRow < 8) {
    for (const dc of [-1, 1]) {
      const nc = c + dc;
      if (nc >= 0 && nc < 8 && board[pawnRow * 8 + nc] === pawn) return true;
    }
  }
  const knight = by === "w" ? "N" : "n";
  for (const [dr, dc] of KNIGHT) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr * 8 + nc] === knight) return true;
  }
  const bishop = by === "w" ? "B" : "b";
  const rook = by === "w" ? "R" : "r";
  const queen = by === "w" ? "Q" : "q";
  for (const [dr, dc] of BISHOP) {
    if (rayHits(board, r, c, dr, dc, bishop, queen)) return true;
  }
  for (const [dr, dc] of ROOK) {
    if (rayHits(board, r, c, dr, dc, rook, queen)) return true;
  }
  const king = by === "w" ? "K" : "k";
  for (const [dr, dc] of KING) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr * 8 + nc] === king) return true;
  }
  return false;
}

function kingAttacked(board: string[], side: Side): boolean {
  const sq = kingSquare(board, side);
  if (sq < 0) return true;
  return attacked(board, sq, side === "w" ? "b" : "w");
}

function pushPawn(out: ChessMove[], from: number, to: number, promote: boolean) {
  if (!promote) {
    out.push({ from, to });
    return;
  }
  for (const promotion of ["q", "r", "b", "n"] as const) out.push({ from, to, promotion });
}

function pseudoMoves(pos: Pos): ChessMove[] {
  const { board, turn } = pos;
  const out: ChessMove[] = [];
  const dir = turn === "w" ? -1 : 1;
  const startRank = turn === "w" ? 6 : 1;
  const lastRank = turn === "w" ? 0 : 7;

  for (let i = 0; i < 64; i++) {
    const piece = board[i] ?? "";
    if (!own(turn, piece)) continue;
    const r = Math.floor(i / 8);
    const c = i % 8;
    const kind = piece.toUpperCase();

    if (kind === "P") {
      const nr = r + dir;
      if (nr < 0 || nr > 7) continue;
      const ahead = nr * 8 + c;
      if (!(board[ahead] ?? "")) {
        pushPawn(out, i, ahead, nr === lastRank);
        if (r === startRank) {
          const two = (r + dir * 2) * 8 + c;
          if (!(board[two] ?? "")) out.push({ from: i, to: two });
        }
      }
      for (const dc of [-1, 1]) {
        const nc = c + dc;
        if (nc < 0 || nc > 7) continue;
        const cap = nr * 8 + nc;
        const target = board[cap] ?? "";
        if (target && enemy(turn, target) && target !== "K" && target !== "k") {
          pushPawn(out, i, cap, nr === lastRank);
        } else if (pos.ep === cap) {
          out.push({ from: i, to: cap });
        }
      }
      continue;
    }

    if (kind === "N") {
      for (const [dr, dc] of KNIGHT) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
        const j = nr * 8 + nc;
        const target = board[j] ?? "";
        if (!target || (enemy(turn, target) && target !== "K" && target !== "k")) out.push({ from: i, to: j });
      }
      continue;
    }

    if (kind === "K") {
      for (const [dr, dc] of KING) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
        const j = nr * 8 + nc;
        const target = board[j] ?? "";
        if (!target || (enemy(turn, target) && target !== "K" && target !== "k")) out.push({ from: i, to: j });
      }
      continue;
    }

    const dirs = kind === "B" ? BISHOP : kind === "R" ? ROOK : KING;
    for (const [dr, dc] of dirs) {
      let nr = r + dr;
      let nc = c + dc;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const j = nr * 8 + nc;
        const target = board[j] ?? "";
        if (!target) out.push({ from: i, to: j });
        else {
          if (enemy(turn, target) && target !== "K" && target !== "k") out.push({ from: i, to: j });
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  }

  const opp: Side = turn === "w" ? "b" : "w";
  for (const castle of CASTLES) {
    if (castle.side !== turn || !pos.castling.includes(castle.right)) continue;
    const king = turn === "w" ? "K" : "k";
    const rook = turn === "w" ? "R" : "r";
    if (board[castle.kingFrom] !== king || board[castle.rookFrom] !== rook) continue;
    if (castle.empty.some((sq) => board[sq])) continue;
    if (castle.safe.some((sq) => attacked(board, sq, opp))) continue;
    out.push({ from: castle.kingFrom, to: castle.kingTo });
  }

  return out;
}

function play(pos: Pos, move: ChessMove): Pos {
  const board = pos.board.slice();
  const piece = board[move.from] ?? "";
  const side: Side = piece === piece.toUpperCase() ? "w" : "b";
  let captured = Boolean(board[move.to]);
  if ((piece === "P" || piece === "p") && pos.ep !== null && move.to === pos.ep) {
    const capSq = side === "w" ? move.to + 8 : move.to - 8;
    board[capSq] = "";
    captured = true;
  }
  board[move.to] = move.promotion ? (side === "w" ? move.promotion.toUpperCase() : move.promotion) : piece;
  board[move.from] = "";
  if ((piece === "K" || piece === "k") && Math.abs(move.to - move.from) === 2) {
    const castle = CASTLES.find((c) => c.kingFrom === move.from && c.kingTo === move.to);
    if (castle) {
      board[castle.rookTo] = board[castle.rookFrom] ?? "";
      board[castle.rookFrom] = "";
    }
  }

  let castling = pos.castling;
  const drop = (right: string) => {
    castling = castling.replace(right, "");
  };
  if (piece === "K") {
    drop("K");
    drop("Q");
  }
  if (piece === "k") {
    drop("k");
    drop("q");
  }
  if (move.from === 63 || move.to === 63) drop("K");
  if (move.from === 56 || move.to === 56) drop("Q");
  if (move.from === 7 || move.to === 7) drop("k");
  if (move.from === 0 || move.to === 0) drop("q");

  const nextEp =
    (piece === "P" || piece === "p") && Math.abs(move.to - move.from) === 16
      ? (move.from + move.to) / 2
      : null;

  return {
    board,
    turn: side === "w" ? "b" : "w",
    castling: normalizeCastle(castling),
    ep: nextEp,
    halfmove: piece === "P" || piece === "p" || captured ? 0 : pos.halfmove + 1,
    fullmove: pos.fullmove + (side === "b" ? 1 : 0),
  };
}

function legalMoves(pos: Pos): ChessMove[] {
  const out: ChessMove[] = [];
  for (const move of pseudoMoves(pos)) {
    const next = play(pos, move);
    if (!kingAttacked(next.board, pos.turn)) out.push(move);
  }
  return out;
}

function posKey(pos: Pos): string {
  let squares = "";
  for (const piece of pos.board) squares += piece || ".";
  return `${squares} ${pos.turn} ${pos.castling} ${pos.ep ?? "-"}`;
}

function repetitions(seen: string[], pos: Pos): number {
  const key = posKey(pos);
  let n = 0;
  for (const entry of seen) if (entry === key) n++;
  return n;
}

function insufficient(board: string[]): boolean {
  let knights = 0;
  const whiteBishops: number[] = [];
  const blackBishops: number[] = [];
  let other = 0;
  for (let i = 0; i < 64; i++) {
    const piece = board[i] ?? "";
    if (!piece || piece === "K" || piece === "k") continue;
    if (piece === "N" || piece === "n") knights++;
    else if (piece === "B") whiteBishops.push((Math.floor(i / 8) + (i % 8)) % 2);
    else if (piece === "b") blackBishops.push((Math.floor(i / 8) + (i % 8)) % 2);
    else other++;
  }
  if (other) return false;
  const bishops = whiteBishops.length + blackBishops.length;
  const minors = knights + bishops;
  if (minors === 0) return true;
  if (minors === 1) return true;
  return (
    knights === 0 &&
    whiteBishops.length === 1 &&
    blackBishops.length === 1 &&
    whiteBishops[0] === blackBishops[0]
  );
}

function publish(
  pos: Pos,
  seen: string[],
  lastFrom: number | null,
  lastTo: number | null,
): ChessState {
  const moves = legalMoves(pos);
  return {
    kind: "chess",
    cols: 8,
    ...pos,
    seen,
    moves,
    check: kingAttacked(pos.board, pos.turn),
    lastFrom,
    lastTo,
  };
}

function matchMove(moves: ChessMove[], move: ChessMove): ChessMove | undefined {
  const promo = move.promotion?.toLowerCase() as Promo | undefined;
  const same = moves.filter((m) => m.from === move.from && m.to === move.to);
  if (!same.length) return;
  if (promo) return same.find((m) => m.promotion === promo);
  return same.find((m) => !m.promotion) ?? same.find((m) => m.promotion === "q");
}

function commit(state: ChessState, move: ChessMove): ChessState {
  const next = play(toPos(state), move);
  return publish(next, [...state.seen, posKey(next)], move.from, move.to);
}

function toPos(state: ChessState): Pos {
  return {
    board: state.board,
    turn: state.turn,
    castling: state.castling,
    ep: state.ep,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
  };
}

function pieceVal(piece: string): number {
  switch (piece.toUpperCase()) {
    case "P":
      return 100;
    case "N":
      return 320;
    case "B":
      return 330;
    case "R":
      return 500;
    case "Q":
      return 900;
    default:
      return 0;
  }
}

function moveRank(pos: Pos, move: ChessMove): number {
  const victim = pos.board[move.to] ?? "";
  const attacker = pos.board[move.from] ?? "";
  let score = 0;
  if (victim) score += 10 * pieceVal(victim) - pieceVal(attacker);
  if (move.promotion === "q") score += 800;
  else if (move.promotion) score += 300;
  if (pos.ep !== null && move.to === pos.ep) score += 100;
  return score;
}

function orderMoves(pos: Pos, moves: ChessMove[]): ChessMove[] {
  return moves
    .map((move) => ({ move, score: moveRank(pos, move) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.move);
}

function evaluate(pos: Pos): number {
  let score = 0;
  let whiteBishops = 0;
  let blackBishops = 0;
  for (let i = 0; i < 64; i++) {
    const piece = pos.board[i] ?? "";
    if (!piece) continue;
    score += MAT[piece] ?? 0;
    const table = PST[piece.toUpperCase()];
    if (!table) continue;
    const sq = piece === piece.toUpperCase() ? i : i ^ 56;
    const placed = table[sq] ?? 0;
    score += piece === piece.toUpperCase() ? placed : -placed;
    if (piece === "B") whiteBishops++;
    if (piece === "b") blackBishops++;
  }
  if (whiteBishops >= 2) score += 30;
  if (blackBishops >= 2) score -= 30;
  return pos.turn === "w" ? score : -score;
}

function tactical(pos: Pos, moves: ChessMove[]): ChessMove[] {
  return moves.filter(
    (move) =>
      Boolean(pos.board[move.to]) ||
      Boolean(move.promotion) ||
      (pos.ep !== null && move.to === pos.ep),
  );
}

function quiesce(pos: Pos, alpha: number, beta: number, ply: number): number {
  const stand = evaluate(pos);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (ply >= 2) return alpha;
  for (const move of orderMoves(pos, tactical(pos, legalMoves(pos)))) {
    const score = -quiesce(play(pos, move), -beta, -alpha, ply + 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function search(pos: Pos, depth: number, alpha: number, beta: number): number {
  if (depth <= 0) return quiesce(pos, alpha, beta, 0);
  if (insufficient(pos.board) || pos.halfmove >= 100) return 0;
  const moves = orderMoves(pos, legalMoves(pos));
  if (!moves.length) return kingAttacked(pos.board, pos.turn) ? -20000 - depth : 0;
  let best = -1_000_000;
  for (const move of moves) {
    const score = -search(play(pos, move), depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

function chooseBotMove(pos: Pos): ChessMove | null {
  const moves = orderMoves(pos, legalMoves(pos));
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0]!;
  const depth = moves.length <= 10 ? 3 : 2;
  const scored = moves.map((move) => ({
    move,
    score: -search(play(pos, move), depth - 1, -1_000_000, 1_000_000),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!.score;
  const window = top >= 8000 ? 0 : 20;
  const pool = scored.filter((entry) => entry.score >= top - window);
  return pool[Math.floor(Math.random() * pool.length)]!.move;
}

function outcome(state: ChessState): EngineStatus {
  if (!state.moves.length) {
    if (!state.check) return "draw";
    return state.turn === "w" ? "bot_win" : "human_win";
  }
  if (insufficient(state.board) || state.halfmove >= 100 || repetitions(state.seen, toPos(state)) >= 3) {
    return "draw";
  }
  return "playing";
}

function fresh(): ChessState {
  const pos: Pos = {
    board: startBoard(),
    turn: "w",
    castling: "KQkq",
    ep: null,
    halfmove: 0,
    fullmove: 1,
  };
  return publish(pos, [posKey(pos)], null, null);
}

export const chessEngine: GameEngine<ChessState, ChessMove> = {
  id: "chess",
  name: "Chess",
  description: "Standard chess. You are white against the arcade bot.",
  rules:
    "You play white along the bottom. Tap a piece, then a highlighted square. Pawns promote on the last rank — pick the piece. Castling, en passant, and check follow standard chess. Checkmate wins. Stalemate, threefold repetition, the fifty-move rule, and insufficient material draw.",
  newState: fresh,
  applyHumanMove(state, move): MoveResult<ChessState> {
    if (state.turn !== "w") return { state, illegal: true };
    if (!Number.isInteger(move.from) || !Number.isInteger(move.to)) return { state, illegal: true };
    const found = matchMove(state.moves, move);
    if (!found) return { state, illegal: true };
    return { state: commit(state, found) };
  },
  applyBotMove(state) {
    if (state.turn !== "b" || !state.moves.length) return state;
    const choice = chooseBotMove(toPos(state));
    if (!choice) return state;
    return commit(state, choice);
  },
  status: outcome,
};

/** Load a position. Used to check move generation against known perft counts. */
export function chessLoad(
  board: string[],
  opts?: { turn?: Side; castling?: string; ep?: number | null; halfmove?: number },
): ChessState {
  const pos: Pos = {
    board: board.slice(),
    turn: opts?.turn ?? "w",
    castling: normalizeCastle(opts?.castling ?? "KQkq"),
    ep: opts?.ep ?? null,
    halfmove: opts?.halfmove ?? 0,
    fullmove: 1,
  };
  return publish(pos, [posKey(pos)], null, null);
}

export function chessApply(state: ChessState, move: ChessMove): ChessState {
  const found = matchMove(state.moves, move);
  if (!found) throw new Error(`illegal chess move ${move.from}->${move.to}`);
  return commit(state, found);
}

export function chessPerft(state: ChessState, depth: number): number {
  return perft(toPos(state), depth);
}

function perft(pos: Pos, depth: number): number {
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) nodes += perft(play(pos, move), depth - 1);
  return nodes;
}
