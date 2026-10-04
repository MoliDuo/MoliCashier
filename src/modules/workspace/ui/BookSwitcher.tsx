"use client";

import { Fragment } from "react";
import { Check, ChevronDown } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import type { RecordScope } from "@/modules/ledger/filters";
import { resolveLiveRecordScope } from "../record-scope";
import { useWorkspaceStore } from "../store";
import { bookScopeCopy } from "@/copy/common";

interface BookSwitcherProps {
  disabled?: boolean;
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
}

/**
 * The book being viewed, in the top bar: 总账 or one book. Picking one is this
 * device's preference, not a history entry, so it lives in the workspace store
 * (and its cookie) rather than the URL.
 */
export function BookSwitcher({ disabled = false, align = "end" }: BookSwitcherProps) {
  const { books } = useBooks({});
  const storedScope = useWorkspaceStore((state) => state.bookId);
  const setScope = useWorkspaceStore((state) => state.setBookId);
  const scope = resolveLiveRecordScope(storedScope, books);
  const current = books?.find((book) => book.id === scope);
  // A remembered book is named once the list has loaded; until then the
  // trigger keeps its place without guessing.
  const label = scope == null ? bookScopeCopy.all : (current?.name ?? "…");

  const options: readonly { scope: RecordScope; label: string }[] = [
    { scope: null, label: bookScopeCopy.all },
    ...(books ?? []).map((book) => ({ scope: book.id as RecordScope, label: book.name })),
  ];

  // A ledger with no books has nothing to switch between.
  if (books != null && books.length === 0) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled || books == null}>
        <button
          type="button"
          aria-label={`${bookScopeCopy.label}：${label}`}
          className={textRoleClassName(
            "bodyStrong",
            "inline-flex h-9 min-w-0 max-w-[12rem] items-center gap-1 rounded-md px-2 transition-colors hover:bg-surface2 disabled:opacity-60"
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-52">
        {options.map((option, index) => (
          <Fragment key={option.scope ?? "all"}>
            {index === 1 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              aria-current={scope === option.scope ? "true" : undefined}
              onSelect={() => {
                if (scope !== option.scope) setScope(option.scope);
              }}
            >
              <Check
                aria-hidden="true"
                className={cn("mr-2 size-4", scope === option.scope ? "opacity-100" : "opacity-0")}
              />
              <span className="truncate">{option.label}</span>
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
