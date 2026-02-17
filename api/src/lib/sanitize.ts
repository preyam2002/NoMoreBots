export interface SanitizedText {
  text: string;
  wasModified: boolean;
  issues: string[];
}

export function sanitizeTweetText(input: string): SanitizedText {
  const issues: string[] = [];
  let text = input;

  if (typeof input !== "string") {
    return { text: "", wasModified: true, issues: ["Input was not a string"] };
  }

  if (input.length > 2000) {
    text = input.substring(0, 2000);
    issues.push("Text truncated to 2000 characters");
  }

  if (input.length < 1) {
    return { text: "", wasModified: true, issues: ["Text was empty"] };
  }

  const suspiciousPatterns = [
    { pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, message: "Control characters removed" },
    { pattern: /(\0)/g, message: "Null bytes removed" },
    { pattern: /(<script[^>]*>)/gi, message: "Script tags removed" },
    { pattern: /(javascript:)/gi, message: "JavaScript protocol removed" },
    { pattern: /on\w+=/gi, message: "Event handlers removed" },
  ];

  for (const { pattern, message } of suspiciousPatterns) {
    if (pattern.test(text)) {
      text = text.replace(pattern, "");
      issues.push(message);
    }
  }

  text = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();

  return {
    text,
    wasModified: issues.length > 0,
    issues,
  };
}

export function sanitizeAuthorHandle(input: string): SanitizedText {
  const issues: string[] = [];
  let handle = input;

  if (typeof input !== "string") {
    return { text: "unknown", wasModified: true, issues: ["Input was not a string"] };
  }

  handle = handle.replace(/^@/, "").trim();

  handle = handle.replace(/[^a-zA-Z0-9_]/g, "");

  if (handle.length > 50) {
    handle = handle.substring(0, 50);
    issues.push("Handle truncated to 50 characters");
  }

  if (handle.length < 1) {
    return { text: "unknown", wasModified: true, issues: ["Handle was invalid"] };
  }

  return {
    text: handle.toLowerCase(),
    wasModified: issues.length > 0,
    issues,
  };
}

export function sanitizeKeyword(input: string): SanitizedText {
  const issues: string[] = [];
  let keyword = input.trim().toLowerCase();

  if (typeof input !== "string") {
    return { text: "", wasModified: true, issues: ["Input was not a string"] };
  }

  keyword = keyword.replace(/[^\w\s-]/g, "");

  if (keyword.length > 100) {
    keyword = keyword.substring(0, 100);
    issues.push("Keyword truncated to 100 characters");
  }

  if (keyword.length < 2) {
    return { text: "", wasModified: true, issues: ["Keyword too short"] };
  }

  return {
    text: keyword,
    wasModified: issues.length > 0,
    issues,
  };
}

export function sanitizeForDatabase(input: string, maxLength: number = 1000): string {
  const sanitized = input
    .replace(/[\x00-\x1F\x7F]/g, "")
    .substring(0, maxLength);
  return sanitized;
}
