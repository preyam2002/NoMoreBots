import {
  sanitizeTweetText,
  sanitizeAuthorHandle,
  sanitizeKeyword,
  sanitizeForDatabase,
} from "../sanitize";

describe("Sanitization Module", () => {
  describe("sanitizeTweetText", () => {
    it("should return clean text as-is", () => {
      const input = "This is a normal tweet";
      const result = sanitizeTweetText(input);

      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
      expect(result.issues).toHaveLength(0);
    });

    it("should truncate text over 2000 characters", () => {
      const input = "a".repeat(2500);
      const result = sanitizeTweetText(input);

      expect(result.text.length).toBe(2000);
      expect(result.wasModified).toBe(true);
      expect(result.issues).toContain("Text truncated to 2000 characters");
    });

    it("should remove control characters including null bytes", () => {
      const input = "Hello\x00World\x1F";
      const result = sanitizeTweetText(input);

      expect(result.text).not.toContain("\0");
      expect(result.issues).toContain("Control characters removed");
    });

    it("should remove script tags", () => {
      const input = "Hello <script>alert('xss')</script> World";
      const result = sanitizeTweetText(input);

      expect(result.text).not.toContain("<script");
      expect(result.issues).toContain("Script tags removed");
    });

    it("should remove javascript protocol", () => {
      const input = "Click javascript:alert('xss') here";
      const result = sanitizeTweetText(input);

      expect(result.text).not.toContain("javascript:");
      expect(result.issues).toContain("JavaScript protocol removed");
    });

    it("should remove event handlers", () => {
      const input = "<img onerror=alert('xss')>";
      const result = sanitizeTweetText(input);

      expect(result.text).not.toContain("onerror=");
      expect(result.issues).toContain("Event handlers removed");
    });

    it("should normalize line endings", () => {
      const input = "Hello\r\nWorld\rTest";
      const result = sanitizeTweetText(input);

      expect(result.text).toBe("Hello\nWorld\nTest");
    });

    it("should handle empty strings", () => {
      const result = sanitizeTweetText("");

      expect(result.text).toBe("");
      expect(result.wasModified).toBe(true);
    });

    it("should handle non-string input", () => {
      const result = sanitizeTweetText(null as unknown as string);

      expect(result.text).toBe("");
      expect(result.wasModified).toBe(true);
    });
  });

  describe("sanitizeAuthorHandle", () => {
    it("should clean valid handles", () => {
      const result = sanitizeAuthorHandle("username123");

      expect(result.text).toBe("username123");
      expect(result.wasModified).toBe(false);
    });

    it("should remove @ prefix", () => {
      const result = sanitizeAuthorHandle("@username");

      expect(result.text).toBe("username");
      expect(result.wasModified).toBe(false);
    });

    it("should remove special characters", () => {
      const result = sanitizeAuthorHandle("user@name!");

      expect(result.text).toBe("username");
      expect(result.wasModified).toBe(false);
    });

    it("should truncate long handles", () => {
      const result = sanitizeAuthorHandle("a".repeat(60));

      expect(result.text.length).toBe(50);
      expect(result.wasModified).toBe(true);
    });

    it("should return unknown for invalid handles", () => {
      const result = sanitizeAuthorHandle("!!!");

      expect(result.text).toBe("unknown");
      expect(result.wasModified).toBe(true);
    });

    it("should convert to lowercase", () => {
      const result = sanitizeAuthorHandle("UserName");

      expect(result.text).toBe("username");
    });
  });

  describe("sanitizeKeyword", () => {
    it("should clean valid keywords", () => {
      const result = sanitizeKeyword("bitcoin");

      expect(result.text).toBe("bitcoin");
      expect(result.wasModified).toBe(false);
    });

    it("should remove special characters", () => {
      const result = sanitizeKeyword("crypto!@#");

      expect(result.text).toBe("crypto");
      expect(result.wasModified).toBe(false);
    });

    it("should truncate long keywords", () => {
      const result = sanitizeKeyword("a".repeat(150));

      expect(result.text.length).toBe(100);
      expect(result.wasModified).toBe(true);
    });

    it("should reject too short keywords", () => {
      const result = sanitizeKeyword("x");

      expect(result.text).toBe("");
      expect(result.wasModified).toBe(true);
    });

    it("should convert to lowercase", () => {
      const result = sanitizeKeyword("Crypto");

      expect(result.text).toBe("crypto");
    });

    it("should trim whitespace", () => {
      const result = sanitizeKeyword("  bitcoin  ");

      expect(result.text).toBe("bitcoin");
    });
  });

  describe("sanitizeForDatabase", () => {
    it("should remove control characters", () => {
      const input = "Hello\x00World\x1F";
      const result = sanitizeForDatabase(input);

      expect(result).not.toContain("\0");
      expect(result).not.toContain("\x1F");
    });

    it("should truncate to max length", () => {
      const input = "a".repeat(150);
      const result = sanitizeForDatabase(input, 100);

      expect(result.length).toBe(100);
    });

    it("should preserve normal text", () => {
      const input = "Normal tweet text";
      const result = sanitizeForDatabase(input);

      expect(result).toBe(input);
    });
  });
});
