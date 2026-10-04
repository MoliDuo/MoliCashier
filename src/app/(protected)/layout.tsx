import { SIGN_IN_PATH } from "@/modules/auth/constants";
import { redirect } from "next/navigation";
import { Providers } from "@/components/providers";
import { resolveAuthenticatedHome } from "@/modules/workspace/server/resolve-authenticated-home";
import { UnauthorizedError } from "@/lib/errors";

/**
 * Every route under here reads the session, so there is nothing to prerender:
 * without this the build tries to render the page and reaches for a database
 * that is not there.
 */
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  try {
    await resolveAuthenticatedHome();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect(SIGN_IN_PATH);
    }
    throw error;
  }

  return <Providers>{children}</Providers>;
}
