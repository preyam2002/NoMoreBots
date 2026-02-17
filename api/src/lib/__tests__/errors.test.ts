import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ExternalServiceError,
  handleError,
} from "../errors";

describe("Error Classes", () => {
  describe("AppError", () => {
    it("should create an error with correct properties", () => {
      const error = new AppError("Test error", 400, "TEST_ERROR", true);

      expect(error.message).toBe("Test error");
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe("TEST_ERROR");
      expect(error.isOperational).toBe(true);
    });

    it("should have default values", () => {
      const error = new AppError("Test error");

      expect(error.statusCode).toBe(500);
      expect(error.code).toBeUndefined();
      expect(error.isOperational).toBe(true);
    });
  });

  describe("ValidationError", () => {
    it("should create a validation error", () => {
      const error = new ValidationError("Invalid input");

      expect(error.message).toBe("Invalid input");
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("AuthenticationError", () => {
    it("should create an auth error with default message", () => {
      const error = new AuthenticationError();

      expect(error.message).toBe("Authentication required");
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("AUTH_ERROR");
    });

    it("should create an auth error with custom message", () => {
      const error = new AuthenticationError("Token expired");

      expect(error.message).toBe("Token expired");
    });
  });

  describe("AuthorizationError", () => {
    it("should create an authorization error", () => {
      const error = new AuthorizationError();

      expect(error.message).toBe("Unauthorized");
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe("AUTHZ_ERROR");
    });
  });

  describe("NotFoundError", () => {
    it("should create a not found error", () => {
      const error = new NotFoundError("User not found");

      expect(error.message).toBe("User not found");
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
    });
  });

  describe("RateLimitError", () => {
    it("should create a rate limit error", () => {
      const error = new RateLimitError();

      expect(error.message).toBe("Too many requests");
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe("RATE_LIMIT");
      expect(error.resetTime).toBeUndefined();
    });

    it("should include reset time", () => {
      const resetTime = Date.now() + 60000;
      const error = new RateLimitError("Rate limited", resetTime);

      expect(error.resetTime).toBe(resetTime);
    });
  });

  describe("ExternalServiceError", () => {
    it("should create an external service error", () => {
      const error = new ExternalServiceError("OpenAI", "API timeout");

      expect(error.message).toBe("OpenAI: API timeout");
      expect(error.statusCode).toBe(502);
      expect(error.code).toBe("EXTERNAL_ERROR");
    });
  });
});

describe("handleError", () => {
  it("should handle AppError", () => {
    const error = new AppError("Test error", 400, "TEST_ERROR", true);
    const result = handleError(error);

    expect(result.message).toBe("Test error");
    expect(result.statusCode).toBe(400);
    expect(result.code).toBe("TEST_ERROR");
  });

  it("should handle generic Error", () => {
    const error = new Error("Something went wrong");
    const result = handleError(error);

    expect(result.message).toBe("Something went wrong");
    expect(result.statusCode).toBe(500);
    expect(result.code).toBe("INTERNAL_ERROR");
  });

  it("should handle unknown errors", () => {
    const result = handleError(null);

    expect(result.message).toBe("An unknown error occurred");
    expect(result.statusCode).toBe(500);
    expect(result.code).toBe("UNKNOWN_ERROR");
  });

  it("should handle unknown object errors", () => {
    const result = handleError({ unexpected: "object" });

    expect(result.message).toBe("An unknown error occurred");
    expect(result.statusCode).toBe(500);
  });
});
