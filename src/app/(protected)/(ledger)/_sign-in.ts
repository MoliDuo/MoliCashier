import "server-only";
import { SIGN_IN_PATH } from "@/modules/auth/constants";
import { redirect } from "next/navigation";
import { UnauthorizedError } from "@/lib/errors";

/**
 * The layout and its page render in parallel, so each meets a signed-out
 * request on its own. Both send it to sign in rather than failing the render.
 */
export async function orSignIn<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect(SIGN_IN_PATH);
    throw error;
  }
}
