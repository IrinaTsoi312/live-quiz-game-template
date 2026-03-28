export const generateId = (length: number = 8): string => {
  return Math.random().toString(36).substring(2, 2 + length);
};
