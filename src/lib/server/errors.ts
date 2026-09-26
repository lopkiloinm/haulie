export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function requireCondition(
  condition: unknown,
  code: string,
  message: string,
  status = 409,
): asserts condition {
  if (!condition) throw new ApiError(status, code, message);
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new ApiError(
      503,
      "NOT_CONFIGURED",
      "This service is not available yet.",
    );
  return value;
}
