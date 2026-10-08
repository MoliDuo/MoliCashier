import Link from "next/link";
import { AlertCircle, Home } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { notFoundCopy } from "@/copy/app";

export default function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-screen flex items-center justify-center bg-bg px-4"
    >
      <div className="max-w-md w-full text-center">
        <div className="mb-8 flex justify-center">
          <div className="relative">
            <div className="text-9xl font-bold text-surface2 select-none">404</div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                <AlertCircle aria-hidden="true" className="w-8 h-8 text-primary" />
              </div>
            </div>
          </div>
        </div>
        <h1 className={textRoleClassName("pageTitle", "mb-4")}>{notFoundCopy.title}</h1>
        <p className={textRoleClassName("bodyMuted", "mb-8")}>{notFoundCopy.description}</p>
        <Link
          href="/"
          className={textRoleClassName(
            "sectionTitle",
            "inline-flex items-center justify-center px-6 py-3 border border-transparent font-medium rounded-lg text-white bg-primary hover:bg-primary/90 transition-colors shadow-sm"
          )}
        >
          <Home aria-hidden="true" className="w-5 h-5 mr-2" />
          {notFoundCopy.backToHome}
        </Link>
      </div>
    </main>
  );
}
