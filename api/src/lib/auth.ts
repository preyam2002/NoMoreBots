import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import type { ExtensionUser } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const CLIENT_TOKEN_HEADER = "x-client-token";

export function generateClientToken() {
  return randomBytes(32).toString("base64url");
}

export function hashClientToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenHashMatches(expected: string, candidate: string) {
  const expectedBuffer = Buffer.from(expected, "hex");
  const candidateBuffer = Buffer.from(candidate, "hex");

  if (expectedBuffer.length !== candidateBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, candidateBuffer);
}

export async function authenticateExtensionUser(
  request: Request,
  userId: string
): Promise<ExtensionUser | NextResponse> {
  const clientToken = request.headers.get(CLIENT_TOKEN_HEADER);

  if (!clientToken) {
    return NextResponse.json({ error: "Missing client token" }, { status: 401 });
  }

  const user = await prisma.extensionUser.findUnique({
    where: { id: userId },
  });

  if (!user?.clientTokenHash) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const candidateHash = hashClientToken(clientToken);
  if (!tokenHashMatches(user.clientTokenHash, candidateHash)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return user;
}

export function isAuthErrorResponse(
  value: ExtensionUser | NextResponse
): value is NextResponse {
  return value instanceof NextResponse;
}
