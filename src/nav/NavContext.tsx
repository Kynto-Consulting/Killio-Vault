import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface NavState {
  open: boolean;
  openNav(): void;
  closeNav(): void;
}

const NavCtx = createContext<NavState>({
  open: false,
  openNav: () => {},
  closeNav: () => {},
});

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openNav = useCallback(() => setOpen(true), []);
  const closeNav = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, openNav, closeNav }), [open, openNav, closeNav]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}

export function useNav(): NavState {
  return useContext(NavCtx);
}
