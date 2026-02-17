export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;

  constructor(
    message: string,
    statusCode: number = 500,
    code?: string,
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", true);
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication required") {
    super(message, 401, "AUTH_ERROR", true);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 403, "AUTHZ_ERROR", true);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "NOT_FOUND", true);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends AppError {
  public readonly resetTime?: number;

  constructor(message: string = "Too many requests", resetTime?: number) {
    super(message, 429, "RATE_LIMIT", true);
    this.name = "RateLimitError";
    this.resetTime = resetTime;
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string = "External service error") {
    super(`${service}: ${message}`, 502, "EXTERNAL_ERROR", true);
    this.name = "ExternalServiceError";
  }
}

export function handleError(error: unknown): { message: string; statusCode: number; code?: string } {
  if (error instanceof AppError) {
    return {
      message: error.message,
      statusCode: error.statusCode,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    console.error("[Unexpected Error]", error);

    if (error.name === "ZodError") {
      return {
        message: "Validation error",
        statusCode: 400,
        code: "VALIDATION_ERROR",
      };
    }

    return {
      message: process.env.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : error.message,
      statusCode: 500,
      code: "INTERNAL_ERROR",
    };
  }

  return {
    message: "An unknown error occurred",
    statusCode: 500,
    code: "UNKNOWN_ERROR",
  };
}