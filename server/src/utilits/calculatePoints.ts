export const calculatePoints = (
  isCorrect: boolean,
  timeLimitSec: number,
  timeUsedSec: number
): number => {
  if (!isCorrect) return 0;
  const basePoints = 1000;
  const timeRemaining = Math.max(0, timeLimitSec - timeUsedSec);
  return Math.floor(basePoints * (timeRemaining / timeLimitSec));
};
