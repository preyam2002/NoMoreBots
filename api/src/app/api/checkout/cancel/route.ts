import { NextResponse } from "next/server";
import { authenticateExtensionUser, isAuthErrorResponse } from "@/lib/auth";
import { z } from "zod";

const cancelSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
});

export async function POST(request: Request) {
  try {
    const { userId, sessionId } = cancelSchema.parse(await request.json());
    void sessionId;

    const user = await authenticateExtensionUser(request, userId);
    if (isAuthErrorResponse(user)) {
      return user;
    }

    return NextResponse.json({ 
      success: true,
      message: "Checkout cancelled",
    });
  } catch (error) {
    console.error("Cancel Error:", error);
    return NextResponse.json(
      { error: "Error cancelling checkout" },
      { status: 500 }
    );
  }
}
