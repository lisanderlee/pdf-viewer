"use client";

import { useState } from "react";

export type NavItem = {
  id: string;
  title: string;
  pageNumber: number;
  items: NavItem[];
};

export function PdfNav({
  items,
  activeIds,
  onSelect,
}: {
  items: NavItem[];
  activeIds: string[];
  onSelect: (item: NavItem) => void;
}) {
  const [open, setOpen] = useState(false);

  function select(item: NavItem) {
    onSelect(item);
    setOpen(false);
  }

  return (
    <nav className="pdf-nav" aria-label="Contents">
      <button
        type="button"
        className="pdf-nav-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Contents
      </button>
      <NavList items={items} activeIds={activeIds} onSelect={select} open={open} />
    </nav>
  );
}

function NavList({
  items,
  activeIds,
  onSelect,
  open = false,
  nested = false,
}: {
  items: NavItem[];
  activeIds: string[];
  onSelect: (item: NavItem) => void;
  open?: boolean;
  nested?: boolean;
}) {
  return (
    <ul className={nested ? "pdf-nav-sub" : open ? "pdf-nav-list open" : "pdf-nav-list"}>
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            aria-current={activeIds.includes(item.id) ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
          >
            {item.title}
          </a>
          {item.items.length > 0 ? (
            <NavList items={item.items} activeIds={activeIds} onSelect={onSelect} nested />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
