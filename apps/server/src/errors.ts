export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly userMessage: string;
  constructor(code: string, httpStatus: number, userMessage: string) {
    super(`${code}: ${userMessage}`);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.userMessage = userMessage;
  }
}

export const authRequired = () => new AppError("auth_required", 401, "Open Bloopy from Telegram so we know which nest is yours.");
export const invalidSignature = () => new AppError("invalid_init_data", 401, "Telegram sign-in didn't check out. Reopen Bloopy from Telegram.");
