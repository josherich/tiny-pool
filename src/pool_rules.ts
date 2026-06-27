import type { Ball, Pocketed, PocketedThisShot } from './pool_physics';

export const allBallsStopped = (balls: Ball[]): boolean =>
  balls.every(ball => {
    const linvel = ball.body.linvel();
    const angvel = ball.body.angvel();
    const linearSpeed = Math.sqrt(linvel.x * linvel.x + linvel.z * linvel.z);
    const angularSpeed = Math.sqrt(angvel.x * angvel.x + angvel.y * angvel.y + angvel.z * angvel.z);
    return linearSpeed < 0.15 && angularSpeed < 2.0;
  });

export const canShoot = ({
  mode,
  isMyTurn,
  balls
}: {
  mode: string;
  isMyTurn: boolean;
  balls: Ball[];
}): boolean => {
  if (mode === 'online' && !isMyTurn) return false;
  return balls.every(ball => {
    const linvel = ball.body.linvel();
    const angvel = ball.body.angvel();
    const linearSpeed = Math.sqrt(linvel.x * linvel.x + linvel.y * linvel.y + linvel.z * linvel.z);
    const angularSpeed = Math.sqrt(angvel.x * angvel.x + angvel.y * angvel.y + angvel.z * angvel.z);
    return linearSpeed < 0.15 && angularSpeed < 2.0;
  });
};

export const switchTurn = ({
  mode,
  currentPlayer,
  isMyTurn
}: {
  mode: string;
  currentPlayer: number;
  isMyTurn: boolean;
}) => {
  const nextPlayer = currentPlayer === 1 ? 2 : 1;
  return {
    currentPlayer: nextPlayer,
    isMyTurn: mode === 'online' ? !isMyTurn : isMyTurn
  };
};

export const evaluateTurnSwitch = ({
  currentPlayer,
  mode,
  isMyTurn,
  playerTypes,
  pocketedThisShot
}: {
  currentPlayer: number;
  mode: string;
  isMyTurn: boolean;
  playerTypes: { player1: string | null; player2: string | null };
  pocketedThisShot: PocketedThisShot;
}) => {
  // If cue ball was scratched, always switch turn
  if (pocketedThisShot.cueBall) {
    return {
      playerTypes,
      ...switchTurn({ mode, currentPlayer, isMyTurn })
    };
  }

  // Determine current player's ball type
  const currentPlayerType = currentPlayer === 1
    ? playerTypes.player1
    : playerTypes.player2;

  // If types haven't been assigned yet
  if (!currentPlayerType) {
    // If player pocketed any ball, they get that type and keep their turn
    if (pocketedThisShot.solids.length > 0) {
      if (currentPlayer === 1) {
        playerTypes.player1 = 'solid';
        playerTypes.player2 = 'stripe';
      } else {
        playerTypes.player2 = 'solid';
        playerTypes.player1 = 'stripe';
      }
      return { playerTypes, currentPlayer, isMyTurn };
    }
    if (pocketedThisShot.stripes.length > 0) {
      if (currentPlayer === 1) {
        playerTypes.player1 = 'stripe';
        playerTypes.player2 = 'solid';
      } else {
        playerTypes.player2 = 'stripe';
        playerTypes.player1 = 'solid';
      }
      return { playerTypes, currentPlayer, isMyTurn };
    }
    // Didn't pocket anything, switch turn
    return {
      playerTypes,
      ...switchTurn({ mode, currentPlayer, isMyTurn })
    };
  }

  // Check if player pocketed their assigned ball type
  const pocketedOwn = currentPlayerType === 'solid'
    ? pocketedThisShot.solids.length > 0
    : pocketedThisShot.stripes.length > 0;

  if (!pocketedOwn) {
    return {
      playerTypes,
      ...switchTurn({ mode, currentPlayer, isMyTurn })
    };
  }

  // If they pocketed their own ball type, they keep their turn
  return { playerTypes, currentPlayer, isMyTurn };
};

export const isValidBallPlacement = ({
  physX,
  physZ,
  ballPositions,
  tableLeft,
  tableRight,
  tableTop,
  tableBottom,
  ballRadius
}: {
  physX: number;
  physZ: number;
  ballPositions: { x: number; z: number }[];
  tableLeft: number;
  tableRight: number;
  tableTop: number;
  tableBottom: number;
  ballRadius: number;
}): boolean => {
  // Check within table bounds
  if (physX < tableLeft || physX > tableRight || physZ < tableTop || physZ > tableBottom) {
    return false;
  }

  // Check not overlapping any other ball (2 radii + small gap)
  for (const pos of ballPositions) {
    const dx = pos.x - physX;
    const dz = pos.z - physZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < ballRadius * 2.1) {
      return false;
    }
  }

  return true;
};

export type GameOverResult = {
  winner: number;
  reason: string;
} | null;

export const evaluateGameOver = ({
  currentPlayer,
  playerTypes,
  pocketed
}: {
  currentPlayer: number;
  playerTypes: { player1: string | null; player2: string | null };
  pocketed: Pocketed;
}): GameOverResult => {
  if (!pocketed.eight) return null;

  const currentType = currentPlayer === 1
    ? playerTypes.player1
    : playerTypes.player2;

  const allOwnPocketed = currentType === 'solid'
    ? pocketed.solids.length === 7
    : currentType === 'stripe'
      ? pocketed.stripes.length === 7
      : false;

  if (allOwnPocketed) {
    return {
      winner: currentPlayer,
      reason: 'Pocketed 8-ball after clearing all own balls'
    };
  }

  return {
    winner: currentPlayer === 1 ? 2 : 1,
    reason: 'Pocketed 8-ball early'
  };
};
